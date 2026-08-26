"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { optionalDate } from "@/lib/form-fields";
import { getTagDef } from "@/lib/tags";
import { isIntroStage, TERMINAL_INTRO_STAGES } from "@/lib/intro-stages";
import {
  computeEventTargets,
  type TargetCandidate,
  type TargetSuggestion,
} from "@/lib/event-targets";
import { COMMITMENT_STATUSES } from "@/lib/commitments";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import { EVENT_GUEST_STATUSES, NETWORK_STATUSES } from "@/lib/company-statuses";
import { revalidateActionItemSurfaces } from "@/lib/revalidate";
import {
  RSVP_ATTENDED,
  RSVP_CONFIRMED,
  getEventType,
  isAttending,
  isEventType,
  isEventStage,
  isRsvpState,
} from "@/lib/event-stages";
import {
  generateGuestBriefs,
  type GuestBrief,
  type GuestContext,
} from "@/lib/event-brief";
import {
  generateEventIdeas,
  type EventIdea,
  type IdeaMember,
} from "@/lib/event-ideas";
import {
  generateGuestSuggestions,
  type GuestCandidate,
  type SuggestedGuest,
} from "@/lib/event-guest-suggest";
import {
  generateOutreachEmail,
  isOutreachAngle,
  type OutreachGuest,
} from "@/lib/event-outreach";

// Events and their guest lists (slice 11.7). org_id is stamped from context on
// every write (RLS WITH CHECK backstops it). event_invitees carries a composite FK
// (event_id, org_id) -> events(id, org_id) so an invitee can never straddle orgs;
// the optional contact_id is a plain FK, re-checked inside withOrg like
// contacts.company_id so a foreign contact can't be smuggled onto a guest list.

export async function createEvent(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  const date = optionalDate(formData, "date");
  const venue = String(formData.get("venue") ?? "").trim();
  const theme = String(formData.get("theme") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();

  if (!name || !type) throw new Error("name and type are required");
  if (!isEventType(type)) throw new Error("invalid event type");
  // stage is optional (defaults to "planning"); if supplied it must be in vocabulary.
  if (stage !== "" && !isEventStage(stage))
    throw new Error("invalid event stage");
  if (capacityRaw !== "" && !Number.isInteger(Number(capacityRaw)))
    throw new Error("capacity must be a whole number");

  await withOrg(orgId, async (tx) => {
    // Optional project tie is a plain FK — re-check it inside withOrg (RLS-scoped →
    // null if foreign) so an event can't be linked to another tenant's project.
    if (projectId) {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) throw new Error("project not found");
    }
    await tx.event.create({
      data: {
        orgId,
        name,
        type,
        stage: stage === "" ? "planning" : stage,
        date,
        venue: venue === "" ? null : venue,
        theme: theme === "" ? null : theme,
        description,
        capacity: capacityRaw === "" ? null : Number(capacityRaw),
        projectId: projectId === "" ? null : projectId,
      },
    });
  });

  revalidatePath("/dashboard/events");
}

// Set an event's cost (drives Projected ROI). The findUnique is withOrg-scoped, so a
// foreign eventId resolves to null and is refused.
export async function updateEventCost(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const costRaw = String(formData.get("cost") ?? "").trim();
  if (!eventId) throw new Error("event is required");
  if (costRaw !== "" && !(Number(costRaw) >= 0))
    throw new Error("cost must be a non-negative number");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");
    // cost is a Decimal column — write the validated raw string so Prisma coerces it
    // exactly (Number() would risk float drift on large dollar figures).
    await tx.event.update({
      where: { id: eventId },
      data: { cost: costRaw === "" ? null : costRaw },
    });
  });

  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
}

// Edit an event's core details after creation (mirrors the createEvent fields plus
// the optional venue attribution). projectId/venueCompanyId/venueContactId are plain
// FKs, each re-checked inside withOrg (RLS-scoped → null if foreign) so an event can
// never link to another tenant's project/company/contact.
export async function updateEventDetails(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  const date = optionalDate(formData, "date");
  const venue = String(formData.get("venue") ?? "").trim();
  const theme = String(formData.get("theme") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const venueCompanyId = String(formData.get("venueCompanyId") ?? "").trim();
  const venueContactId = String(formData.get("venueContactId") ?? "").trim();

  if (!eventId) throw new Error("event is required");
  if (!name || !type) throw new Error("name and type are required");
  if (!isEventType(type)) throw new Error("invalid event type");
  if (stage !== "" && !isEventStage(stage))
    throw new Error("invalid event stage");
  if (capacityRaw !== "" && !Number.isInteger(Number(capacityRaw)))
    throw new Error("capacity must be a whole number");

  const prevVenue = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true, venueCompanyId: true, venueContactId: true },
    });
    if (!event) throw new Error("event not found");
    if (projectId) {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) throw new Error("project not found");
    }
    if (venueCompanyId) {
      const company = await tx.company.findUnique({
        where: { id: venueCompanyId },
        select: { id: true },
      });
      if (!company) throw new Error("venue company not found");
    }
    if (venueContactId) {
      const contact = await tx.contact.findUnique({
        where: { id: venueContactId },
        select: { id: true },
      });
      if (!contact) throw new Error("venue contact not found");
    }
    await tx.event.update({
      where: { id: eventId },
      data: {
        name,
        type,
        stage: stage === "" ? "planning" : stage,
        date,
        venue: venue === "" ? null : venue,
        theme: theme === "" ? null : theme,
        description,
        capacity: capacityRaw === "" ? null : Number(capacityRaw),
        projectId: projectId === "" ? null : projectId,
        venueCompanyId: venueCompanyId === "" ? null : venueCompanyId,
        venueContactId: venueContactId === "" ? null : venueContactId,
      },
    });
    return {
      companyId: event.venueCompanyId,
      contactId: event.venueContactId,
    };
  });

  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
  // The venue attribution surfaces on the linked company/contact profile — refresh
  // both the newly-linked profile and any prior one that was reassigned or cleared.
  for (const companyId of new Set(
    [prevVenue.companyId, venueCompanyId === "" ? null : venueCompanyId].filter(
      (v): v is string => v != null,
    ),
  )) {
    revalidatePath(`/dashboard/companies/${companyId}`);
  }
  for (const contactId of new Set(
    [prevVenue.contactId, venueContactId === "" ? null : venueContactId].filter(
      (v): v is string => v != null,
    ),
  )) {
    revalidatePath(`/dashboard/contacts/${contactId}`);
  }
}

// Bulk RSVP transition after an event: every guest who confirmed is marked attended
// (prototype "Mark All Confirmed as Attended", Coterie.html:8239). The updateMany is
// withOrg-scoped so it only ever touches this tenant's invitees for this event.
export async function markAllAttended(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) throw new Error("event is required");

  await withOrg(orgId, (tx) =>
    tx.eventInvitee.updateMany({
      where: { eventId, rsvp: RSVP_CONFIRMED },
      data: { rsvp: RSVP_ATTENDED },
    }),
  );

  // Confirmed→attended shifts the list's "Guests confirmed" tally too.
  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
}

// Log a member who joined as a direct result of an event (prototype draft.conversions,
// Coterie.html:8361). A network company (companyId, re-checked inside withOrg → null if
// foreign) snapshots its name + defaults ARR to its annualValue; an ad-hoc name is
// also allowed. ARR (dollars) feeds the event's Projected ROI.
export async function addConversion(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const nameInput = String(formData.get("name") ?? "").trim();
  const noteInput = String(formData.get("note") ?? "").trim();
  const arrRaw = String(formData.get("arr") ?? "").trim();
  if (!eventId) throw new Error("event is required");
  if (arrRaw !== "" && !(Number(arrRaw) >= 0))
    throw new Error("ARR must be a non-negative number");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");

    let name = nameInput;
    // arr is a Decimal column — keep it as a string (validated non-negative) so
    // Prisma coerces it exactly; default to the linked company's annualValue via
    // Decimal.toString() rather than Number() to avoid float drift.
    let arr: string | null = arrRaw === "" ? null : arrRaw;
    let linkedCompanyId: string | null = null;
    if (companyId) {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { name: true, annualValue: true },
      });
      if (!company) throw new Error("company not found");
      linkedCompanyId = companyId;
      name = name || company.name;
      if (arr === null) arr = company.annualValue.toString();
    }
    if (!name) throw new Error("pick a member or name the new member");

    await tx.eventConversion.create({
      data: { orgId, eventId, companyId: linkedCompanyId, name, arr, note: noteInput },
    });
  });

  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
}

// Remove a logged conversion. The delete is withOrg-scoped, so a foreign id matches
// nothing (RLS no-op), never touching another tenant's rows.
export async function removeConversion(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const conversionId = String(formData.get("conversionId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!conversionId) throw new Error("conversion is required");

  await withOrg(orgId, (tx) =>
    tx.eventConversion.deleteMany({ where: { id: conversionId } }),
  );

  revalidatePath("/dashboard/events");
  if (eventId) revalidatePath(`/dashboard/events/${eventId}`);
}

// Add a guest to an event — either a network contact (contactId) or an external guest
// (externalName). The event's composite FK keeps the invitee in the event's org;
// a supplied contactId is re-checked inside withOrg (RLS-scoped → null if foreign)
// so a cross-org contact can't be attached.
export async function addInvitee(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();
  const externalName = String(formData.get("externalName") ?? "").trim();
  const externalOrg = String(formData.get("externalOrg") ?? "").trim();
  const externalEmail = String(formData.get("externalEmail") ?? "").trim();
  const externalTitle = String(formData.get("externalTitle") ?? "").trim();
  if (!eventId) throw new Error("event is required");
  if (!contactId && !externalName)
    throw new Error("pick a contact or name an external guest");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");

    if (contactId) {
      const contact = await tx.contact.findUnique({
        where: { id: contactId },
        select: { id: true },
      });
      if (!contact) throw new Error("contact not found");
      await tx.eventInvitee.create({
        data: { orgId, eventId, contactId },
      });
    } else {
      await tx.eventInvitee.create({
        data: {
          orgId,
          eventId,
          externalName,
          externalOrg: externalOrg === "" ? null : externalOrg,
          externalEmail: externalEmail === "" ? null : externalEmail,
          externalTitle: externalTitle === "" ? null : externalTitle,
        },
      });
    }
  });

  revalidatePath(`/dashboard/events/${eventId}`);
}

// Update a guest's RSVP. The invitee findUnique is withOrg-scoped, so a foreign
// invitee id resolves to null and is refused.
export async function updateInviteeRsvp(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  const rsvp = String(formData.get("rsvp") ?? "").trim();
  if (!inviteeId || !rsvp) throw new Error("invitee and rsvp are required");
  if (!isRsvpState(rsvp)) throw new Error("invalid rsvp state");

  await withOrg(orgId, async (tx) => {
    const invitee = await tx.eventInvitee.findUnique({
      where: { id: inviteeId },
      select: { id: true },
    });
    if (!invitee) throw new Error("invitee not found");
    await tx.eventInvitee.update({ where: { id: inviteeId }, data: { rsvp } });
  });

  if (eventId) revalidatePath(`/dashboard/events/${eventId}`);
}

// Remove a guest from an event. The delete is withOrg-scoped, so a foreign invitee
// id matches nothing and is a no-op (RLS), never touching another tenant's rows.
export async function removeInvitee(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!inviteeId) throw new Error("invitee is required");

  await withOrg(orgId, (tx) =>
    tx.eventInvitee.deleteMany({ where: { id: inviteeId } }),
  );

  if (eventId) revalidatePath(`/dashboard/events/${eventId}`);
}

// Designate (or clear) the event's primary guest — the guest the event is built for.
// An empty inviteeId clears it. Otherwise the invitee is re-checked inside withOrg
// (RLS-scoped → null if foreign) AND confirmed to belong to THIS event, so a guest
// from another event can never be set as the sponsor.
export async function setEventSponsor(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  if (!eventId) throw new Error("event is required");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");

    if (inviteeId) {
      const invitee = await tx.eventInvitee.findUnique({
        where: { id: inviteeId },
        select: { eventId: true },
      });
      if (!invitee || invitee.eventId !== eventId)
        throw new Error("guest not found on this event");
    }

    await tx.event.update({
      where: { id: eventId },
      data: { sponsorInviteeId: inviteeId === "" ? null : inviteeId },
    });
  });

  revalidatePath(`/dashboard/events/${eventId}`);
}

// Guest brief (slice 11.7, ported from the prototype's showGuestBriefModal). In ONE
// withOrg tx (RLS-scoped to this tenant) it loads the event plus its attending
// guests with their public-facing context, then the engine writes a short bio for
// each. Like the other AI features it's a useActionState action returning state (not
// throwing) so failures render inline; results are EPHEMERAL — nothing is stored.

export type GuestBriefState =
  | { status: "idle" }
  | { status: "ok"; briefs: GuestBrief[] }
  | { status: "empty" }
  | { status: "error"; message: string };

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export async function generateBrief(
  _prev: GuestBriefState,
  formData: FormData,
): Promise<GuestBriefState> {
  const { orgId, userName } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) return { status: "error", message: "Pick an event." };

  const data = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { name: true, date: true, venue: true, theme: true },
    });
    if (!event) return null;
    const invitees = await tx.eventInvitee.findMany({
      where: { eventId },
      select: {
        id: true,
        rsvp: true,
        externalName: true,
        externalOrg: true,
        contact: {
          select: {
            name: true,
            title: true,
            company: {
              select: {
                name: true,
                industry: true,
                lookingFor: true,
                canOffer: true,
                networkTags: true,
              },
            },
          },
        },
      },
    });
    return { event, invitees };
  });

  if (data === null) return { status: "error", message: "Event not found." };

  // Only brief guests who'll be in the room. External guests have no member profile to
  // ground a bio in, so they're skipped (the prototype briefs members only).
  const guests: GuestContext[] = data.invitees
    .filter((i) => isAttending(i.rsvp) && i.contact !== null)
    .map((i) => {
      const c = i.contact!;
      const focusAreas = (c.company?.networkTags ?? [])
        .map((k) => getTagDef(k).label)
        .filter((l) => l.length > 0);
      return {
        inviteeId: i.id,
        name: c.name,
        org: c.company?.name ?? null,
        title: c.title,
        industry: c.company?.industry ?? null,
        seeking: c.company?.lookingFor ?? null,
        brings: c.company?.canOffer ?? null,
        focusAreas,
      };
    });

  if (guests.length === 0) return { status: "empty" };

  try {
    await enforceAiRateLimit(orgId);
    const briefs = await generateGuestBriefs(
      {
        name: data.event.name,
        date: data.event.date ? dateFmt.format(data.event.date) : null,
        venue: data.event.venue,
        theme: data.event.theme,
      },
      userName,
      guests,
    );
    return { status: "ok", briefs };
  } catch (err) {
    console.error("guest brief failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not write guest briefs. Try again." };
  }
}

// Event suggestions (gap-audit cluster D, ported from the prototype's
// doGenerateEventSuggestions). In ONE withOrg tx (RLS-scoped) it assembles the
// tenant's network context — its non-former companies (flagging which have never
// appeared on any guest list), active projects, recent meetings, and past events
// — and hands it to the engine, which proposes distinct events grounded in that
// activity. Like the other AI features it's a useActionState action returning
// state (not throwing); results are EPHEMERAL — nothing is stored.

export type EventIdeasState =
  | { status: "idle" }
  | { status: "ok"; ideas: EventIdea[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export async function suggestEvents(
  _prev: EventIdeasState,
  _formData: FormData,
): Promise<EventIdeasState> {
  const { orgId, orgName } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const companies = await tx.company.findMany({
      where: { status: { not: "former" } },
      select: {
        id: true,
        name: true,
        industry: true,
        status: true,
        networkTags: true,
        canOffer: true,
        lookingFor: true,
      },
    });
    // Every company that has ever appeared on a guest list (via a network contact) —
    // its complement is the "never invited" set the engine prioritises.
    const invited = await tx.eventInvitee.findMany({
      where: { contactId: { not: null } },
      select: { contact: { select: { companyId: true } } },
    });
    const projects = await tx.project.findMany({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
      select: { name: true, stage: true, type: true, county: true },
    });
    const meetings = await tx.meeting.findMany({
      orderBy: { heldAt: "desc" },
      take: 8,
      select: { title: true, heldAt: true, summary: true },
    });
    const events = await tx.event.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 15,
      select: {
        name: true,
        type: true,
        date: true,
        theme: true,
        invitees: { select: { rsvp: true } },
      },
    });
    return { companies, invited, projects, meetings, events };
  });

  // No network to reason over → nothing to suggest.
  if (data.companies.length === 0) return { status: "empty" };

  const invitedCompanyIds = new Set(
    data.invited
      .map((i) => i.contact?.companyId)
      .filter((id): id is string => id != null),
  );

  const members: IdeaMember[] = data.companies.map((c) => ({
    companyId: c.id,
    name: c.name,
    industry: c.industry,
    status: c.status,
    tags: c.networkTags.map((k) => getTagDef(k).label).filter((l) => l.length > 0),
    canOffer: c.canOffer,
    lookingFor: c.lookingFor,
    neverInvited: !invitedCompanyIds.has(c.id),
  }));

  try {
    await enforceAiRateLimit(orgId);
    const ideas = await generateEventIdeas({
      orgName,
      members,
      projects: data.projects.map((p) => ({
        name: p.name,
        stage: p.stage,
        type: p.type,
        county: p.county,
      })),
      recentMeetings: data.meetings.map((m) => ({
        title: m.title,
        date: dateFmt.format(m.heldAt),
        summary: m.summary,
      })),
      eventHistory: data.events.map((e) => ({
        name: e.name,
        type: e.type,
        date: e.date ? dateFmt.format(e.date) : null,
        theme: e.theme,
        attended: e.invitees.filter((i) => isAttending(i.rsvp)).length,
      })),
    });
    return { status: "ok", ideas };
  } catch (err) {
    console.error("event suggestions failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not suggest events. Try again." };
  }
}

// AI guest-list curation (ported from the prototype's "AI Suggest Guest List",
// Coterie.html:8210). In ONE withOrg tx it loads the event, the network contacts
// not yet on the list (with their company profile + a never-invited flag), the
// names already invited, and recent meeting intelligence, then the engine picks
// the best-fitting guests with a one-line reason each. Unlike the ephemeral AI
// features this one PERSISTS: each validated pick becomes an EventInvitee with
// the reason as its note. A second withOrg pass re-checks the current guest list
// so a race can't double-invite. Returns state (not throwing) for inline render.

export type SuggestGuestsState =
  | { status: "idle" }
  | { status: "ok"; added: { contactId: string; name: string; reason: string }[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export async function suggestGuestList(
  _prev: SuggestGuestsState,
  formData: FormData,
): Promise<SuggestGuestsState> {
  const { orgId, orgName } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) return { status: "error", message: "Pick an event." };

  const data = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        name: true,
        type: true,
        theme: true,
        description: true,
        capacity: true,
        project: { select: { name: true, description: true } },
      },
    });
    if (!event) return null;
    // Contacts already on this event's list — skipped as candidates; their names
    // give the engine the "who's already coming" context.
    const invitees = await tx.eventInvitee.findMany({
      where: { eventId },
      select: {
        contactId: true,
        externalName: true,
        contact: { select: { name: true } },
      },
    });
    // Companies that have appeared on ANY event guest list (via a network contact) —
    // the complement flags candidates whose company has never been invited. Ask
    // the DB for distinct company ids so this doesn't fan out over every invitee
    // row across every event.
    const everInvited = await tx.contact.findMany({
      where: { eventInvitees: { some: {} } },
      select: { companyId: true },
      distinct: ["companyId"],
    });
    // Contacts eligible to invite — members, strategic partners, AND prospects
    // (events convert prospects), with the company profile the engine reasons over.
    const contacts = await tx.contact.findMany({
      where: { company: { status: { in: [...EVENT_GUEST_STATUSES] } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        company: {
          select: {
            id: true,
            name: true,
            industry: true,
            lookingFor: true,
            canOffer: true,
            networkTags: true,
          },
        },
      },
    });
    const meetings = await tx.meeting.findMany({
      orderBy: { heldAt: "desc" },
      take: 8,
      select: { title: true, summary: true },
    });
    return { event, invitees, everInvited, contacts, meetings };
  });

  if (data === null) return { status: "error", message: "Event not found." };

  const invitedContactIds = new Set(
    data.invitees.map((i) => i.contactId).filter((v): v is string => v != null),
  );
  const alreadyInvited = data.invitees
    .map((i) => i.contact?.name ?? i.externalName ?? "")
    .filter((n) => n !== "");
  const everInvitedCompanyIds = new Set(
    data.everInvited.map((c) => c.companyId),
  );

  const candidates: GuestCandidate[] = data.contacts
    .filter((c) => !invitedContactIds.has(c.id))
    .map((c) => ({
      contactId: c.id,
      name: c.name,
      company: c.company.name,
      industry: c.company.industry,
      lookingFor: c.company.lookingFor,
      canOffer: c.company.canOffer,
      tags: c.company.networkTags
        .map((k) => getTagDef(k).label)
        .filter((l) => l.length > 0),
      neverInvited: !everInvitedCompanyIds.has(c.company.id),
    }));

  // Everyone eligible is already invited (or there's no network) → nothing to add.
  if (candidates.length === 0) return { status: "empty" };

  let suggestions: SuggestedGuest[];
  try {
    await enforceAiRateLimit(orgId);
    suggestions = await generateGuestSuggestions({
      orgName,
      event: {
        name: data.event.name,
        typeLabel: getEventType(data.event.type).label,
        theme: data.event.theme || data.event.description || null,
        capacity: data.event.capacity,
        project: data.event.project
          ? {
              name: data.event.project.name,
              description: data.event.project.description,
            }
          : null,
      },
      alreadyInvited,
      candidates,
      recentMeetings: data.meetings.map((m) => ({
        title: m.title,
        summary: m.summary,
      })),
    });
  } catch (err) {
    console.error("guest suggestion failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not suggest guests. Try again." };
  }

  // parseGuestSuggestions already dropped invented ids, but re-assert against the
  // candidate set (defense in depth) before writing.
  const validIds = new Set(candidates.map((c) => c.contactId));
  const picks = suggestions.filter((s) => validIds.has(s.contactId));
  if (picks.length === 0) return { status: "empty" };

  const added = await withOrg(orgId, async (tx) => {
    // Re-read the current invited set so a concurrent add can't be double-invited.
    const current = await tx.eventInvitee.findMany({
      where: { eventId, contactId: { not: null } },
      select: { contactId: true },
    });
    const invited = new Set(current.map((i) => i.contactId));
    const toCreate = picks.filter((p) => !invited.has(p.contactId));
    if (toCreate.length === 0) return [];
    await tx.eventInvitee.createMany({
      data: toCreate.map((p) => ({
        orgId,
        eventId,
        contactId: p.contactId,
        notes: p.reason,
      })),
    });
    return toCreate.map((p) => ({
      contactId: p.contactId,
      name: p.name,
      reason: p.reason,
    }));
  });

  revalidatePath(`/dashboard/events/${eventId}`);
  return added.length === 0 ? { status: "empty" } : { status: "ok", added };
}

// Find-Targets connection graph (slice S10b, ported from the prototype's
// scanForTargets). Unlike the AI curator above, this is a deterministic scan of
// the relationship graph: it loads who's already on this event's guest list
// (their companies), then network companies connected to those guests through an
// introduction, a shared project, or a referral, and returns them scored
// strongest-first with the reasons. Read-only — the operator adds a suggestion
// through the normal addInvitee flow. The graph scoring lives in
// @/lib/event-targets so it stays testable without a database.

export type FindTargetsState =
  | { status: "idle" }
  | { status: "ok"; suggestions: TargetSuggestion[]; guestCount: number }
  | { status: "error"; message: string };

export async function findEventTargets(
  _prev: FindTargetsState,
  formData: FormData,
): Promise<FindTargetsState> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) return { status: "error", message: "Pick an event." };

  const data = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) return null;

    // The companies already represented on the guest list (via a network contact).
    const invitees = await tx.eventInvitee.findMany({
      where: { eventId, contactId: { not: null } },
      select: { contact: { select: { companyId: true } } },
    });
    const invitedCompanyIds = [
      ...new Set(
        invitees
          .map((i) => i.contact?.companyId)
          .filter((v): v is string => v != null),
      ),
    ];
    // No network guests yet → no graph to walk.
    if (invitedCompanyIds.length === 0)
      return { invited: [], candidates: [], intros: [], projectLinks: [] };

    const invited = await tx.company.findMany({
      where: { id: { in: invitedCompanyIds } },
      select: { id: true, name: true, referredById: true },
    });

    // Network companies not already on the list, each with the contact we'd add.
    const candidateRows = await tx.company.findMany({
      where: {
        status: { in: [...NETWORK_STATUSES] },
        id: { notIn: invitedCompanyIds },
      },
      select: {
        id: true,
        name: true,
        referredById: true,
        contacts: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          take: 1,
          select: { id: true, name: true },
        },
      },
    });

    // Only active intros that touch an invited guest can form an edge.
    const introRows = await tx.introduction.findMany({
      where: {
        status: { notIn: [...TERMINAL_INTRO_STAGES] },
        OR: [
          { partyA: { companyId: { in: invitedCompanyIds } } },
          { partyB: { companyId: { in: invitedCompanyIds } } },
        ],
      },
      select: {
        status: true,
        partyA: { select: { companyId: true } },
        partyB: { select: { companyId: true } },
      },
    });

    // Only links in projects that an invited guest participates in can be shared.
    // Off-network participants (null company) can't be targeted, so skip them.
    const linkRows = await tx.projectLink.findMany({
      where: {
        companyId: { not: null },
        project: {
          projectLinks: { some: { companyId: { in: invitedCompanyIds } } },
        },
      },
      select: {
        companyId: true,
        project: { select: { id: true, name: true } },
      },
    });

    return { invited, candidates: candidateRows, intros: introRows, projectLinks: linkRows };
  });

  if (data === null) return { status: "error", message: "Event not found." };

  const guestCount = data.invited.length;
  const candidates: TargetCandidate[] = data.candidates
    .filter((c) => c.contacts.length > 0)
    .map((c) => ({
      companyId: c.id,
      contactId: c.contacts[0].id,
      contactName: c.contacts[0].name,
      orgName: c.name,
      referredById: c.referredById,
    }));

  const suggestions = computeEventTargets({
    invited: data.invited.map((c) => ({
      companyId: c.id,
      name: c.name,
      referredById: c.referredById,
    })),
    candidates,
    intros: data.intros.map((i) => ({
      aCompanyId: i.partyA.companyId,
      bCompanyId: i.partyB.companyId,
      status: i.status,
    })),
    projectLinks: data.projectLinks
      .filter((l): l is typeof l & { companyId: string } => l.companyId !== null)
      .map((l) => ({
        projectId: l.project.id,
        projectName: l.project.name,
        companyId: l.companyId,
      })),
  });

  return { status: "ok", suggestions, guestCount };
}

// Event outreach email draft (gap-audit cluster D, ported from the prototype's
// generateInviteEmail / generateOutreachDraft). In one withOrg read it loads the
// event, the one invited network guest with their company context and recent meeting
// topics, and the names of other guests already attending; the engine then drafts
// a personal invitation email from the host to that guest. External guests have no
// member profile to ground a draft in, so they're refused. Unlike the ephemeral AI
// panels this one PERSISTS the draft on the invitee (outreach_draft) and moves it
// to the "draft" stage — so a batch survives a reload — while leaving an
// already-"sent" guest sent. An optional refinement angle steers a redraft.

export type OutreachState =
  | { status: "idle" }
  | { status: "ok"; inviteeId: string; guestName: string; draft: string }
  | { status: "error"; message: string };

export async function draftOutreach(
  _prev: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const { orgId, orgName, userName } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const angleRaw = String(formData.get("angle") ?? "").trim();
  // Untrusted — only a known angle may steer the prompt (else no angle).
  const angle = isOutreachAngle(angleRaw) ? angleRaw : null;
  if (!eventId) return { status: "error", message: "Pick an event." };
  if (!inviteeId) return { status: "error", message: "Pick a guest to invite." };

  const data = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { name: true, date: true, venue: true, theme: true, description: true },
    });
    if (!event) return null;
    const invitee = await tx.eventInvitee.findUnique({
      where: { id: inviteeId },
      select: {
        eventId: true,
        outreachStatus: true,
        contact: {
          select: {
            id: true,
            name: true,
            title: true,
            company: {
              select: {
                name: true,
                industry: true,
                lookingFor: true,
                canOffer: true,
                networkTags: true,
              },
            },
          },
        },
      },
    });
    // Guest must belong to this event and be a network contact (external guests have
    // no profile to ground a personal draft in).
    if (!invitee || invitee.eventId !== eventId || invitee.contact === null) {
      return { event, invitee: null, topics: [] as string[], others: [] as string[] };
    }
    // A couple of recent meeting topics for this contact — the "I know you've been
    // working on X" specificity.
    const meetings = await tx.meetingAttendee.findMany({
      where: { contactId: invitee.contact.id },
      orderBy: { meeting: { heldAt: "desc" } },
      take: 2,
      select: { meeting: { select: { title: true, summary: true } } },
    });
    const topics = meetings
      .map((m) => (m.meeting.summary ?? "").trim() || m.meeting.title.trim())
      .filter((t) => t !== "");
    // Other guests already attending (for the "you'll know someone" angle).
    const attending = await tx.eventInvitee.findMany({
      where: { eventId },
      select: {
        id: true,
        rsvp: true,
        externalName: true,
        contact: { select: { name: true } },
      },
    });
    const others = attending
      .filter((i) => i.id !== inviteeId && isAttending(i.rsvp))
      .map((i) => i.contact?.name ?? i.externalName ?? "")
      .filter((n) => n !== "");
    return { event, invitee, topics, others };
  });

  if (data === null) return { status: "error", message: "Event not found." };
  if (data.invitee === null || data.invitee.contact === null)
    return {
      status: "error",
      message: "Pick a network guest — external guests have no profile to draft from.",
    };

  const c = data.invitee.contact;
  const guest: OutreachGuest = {
    name: c.name,
    org: c.company?.name ?? null,
    title: c.title,
    industry: c.company?.industry ?? null,
    seeking: c.company?.lookingFor ?? null,
    brings: c.company?.canOffer ?? null,
    focusAreas: (c.company?.networkTags ?? [])
      .map((k) => getTagDef(k).label)
      .filter((l) => l.length > 0),
    recentTopics: data.topics,
  };

  const wasSent = data.invitee.outreachStatus === "sent";

  try {
    await enforceAiRateLimit(orgId);
    const draft = await generateOutreachEmail({
      orgName,
      host: userName,
      event: {
        name: data.event.name,
        date: data.event.date ? dateFmt.format(data.event.date) : null,
        venue: data.event.venue,
        theme: data.event.theme || data.event.description || null,
      },
      guest,
      confirmedGuests: data.others,
      angle,
    });
    if (draft === "")
      return { status: "error", message: "The draft came back empty. Try again." };
    // Persist the draft (RLS-scoped update) so a batch survives a reload. A guest
    // already marked "sent" keeps that stage; otherwise it moves to "draft". No
    // revalidate — the outreach panel owns its display and re-reads on next load.
    await withOrg(orgId, (tx) =>
      tx.eventInvitee.updateMany({
        where: { id: inviteeId },
        data: { outreachDraft: draft, outreachStatus: wasSent ? "sent" : "draft" },
      }),
    );
    return { status: "ok", inviteeId, guestName: guest.name, draft };
  } catch (err) {
    console.error("event outreach failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not draft the invitation. Try again." };
  }
}

// Mark a guest's invitation as sent (or move it back to draft). Persists the
// current draft body too, so a host edit before "Mark sent" sticks. The updateMany
// is withOrg-scoped, so a foreign invitee id matches nothing (RLS no-op). No
// revalidate — the outreach panel updates optimistically and re-reads on next load.
export async function markOutreachSent(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const sent = String(formData.get("sent") ?? "").trim() === "true";
  const draft = String(formData.get("draft") ?? "");
  if (!inviteeId) throw new Error("invitee is required");

  await withOrg(orgId, (tx) =>
    tx.eventInvitee.updateMany({
      where: { id: inviteeId },
      data: {
        outreachDraft: draft,
        outreachStatus: sent ? "sent" : "draft",
        outreachSentAt: sent ? new Date() : null,
      },
    }),
  );
}

// ── Post-event debrief ──────────────────────────────────────────────────────
// The prototype captured a free-text event recap in the event modal. Here it's
// the event.notes column (already present, defaults ""). The findUnique runs
// inside withOrg (RLS-scoped), so a foreign eventId resolves to null and is
// refused; the update is likewise scoped.

export async function updateEventNotes(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!eventId) throw new Error("event is required");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");
    await tx.event.update({ where: { id: eventId }, data: { notes } });
  });

  revalidatePath(`/dashboard/events/${eventId}`);
}

// ── Event follow-ups (action items surfaced from a debrief) ──────────────────
// A follow-up is an action_item anchored to the event (event_id). Like a company
// commitment it carries a direction: "we owe" (org staff -> ownerUserId) or "they
// owe" (a guest of THIS event -> ownerContactId), mapped to the owner-XOR column
// and re-validated server-side. The event_id composite FK keeps the row in the
// event's org. Follow-ups also surface on the global Commitments workspace, so we
// revalidate it alongside the event.

export async function addEventActionItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 500);
  const direction = String(formData.get("direction") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();
  const dueDate = optionalDate(formData, "dueDate");

  if (!eventId) throw new Error("event is required");
  if (!text) throw new Error("a follow-up is required");
  if (direction !== "we_owe" && direction !== "they_owe")
    throw new Error("invalid direction");
  if (!ownerId) throw new Error("an owner is required");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");

    let ownerUserId: string | null = null;
    let ownerContactId: string | null = null;
    if (direction === "we_owe") {
      // org_memberships carry no RLS — scope explicitly by org+user.
      const member = await prisma.orgMembership.findUnique({
        where: { orgId_userId: { orgId, userId: ownerId } },
        select: { userId: true },
      });
      if (!member) throw new Error("owner is not a member of this organization");
      ownerUserId = ownerId;
    } else {
      // A "they owe" owner must be a guest on this event.
      const invitee = await tx.eventInvitee.findFirst({
        where: { eventId, contactId: ownerId },
        select: { id: true },
      });
      if (!invitee) throw new Error("owner is not a guest on this event");
      ownerContactId = ownerId;
    }

    await tx.actionItem.create({
      data: {
        orgId,
        eventId,
        text,
        status: "open",
        dueDate,
        ownerUserId,
        ownerContactId,
      },
    });
  });

  revalidateActionItemSurfaces();
}

export async function updateEventActionItemStatus(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !eventId) throw new Error("follow-up and event are required");
  if (!(COMMITMENT_STATUSES as readonly string[]).includes(status))
    throw new Error("invalid status");

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id, eventId }, data: { status } }),
  );
  revalidateActionItemSurfaces();
}

export async function deleteEventActionItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!id || !eventId) throw new Error("follow-up and event are required");

  await withOrg(orgId, (tx) =>
    tx.actionItem.deleteMany({ where: { id, eventId } }),
  );
  revalidateActionItemSurfaces();
}

// ── Introductions made at an event ──────────────────────────────────────────
// Logs a first-class Introduction (build item 4) anchored to the event it was
// made at (event_id). Mirrors createIntroduction: both parties are re-verified
// withOrg-scoped (plain FKs bypass RLS), must differ, and the status must be a
// valid intro stage. source="manual". Both the event and the introductions board
// reflect the new row.

export type LogIntroState =
  | { status: "saved" }
  | { status: "error"; message: string };

export async function logIntroductionAtEvent(
  formData: FormData,
): Promise<LogIntroState> {
  const { orgId, userId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const partyAContactId = String(formData.get("partyAContactId") ?? "").trim();
  const partyBContactId = String(formData.get("partyBContactId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const madeOn = optionalDate(formData, "madeOn");

  if (!eventId) return { status: "error", message: "An event is required." };
  if (!partyAContactId || !partyBContactId)
    return { status: "error", message: "Select both guests." };
  if (!status || !isIntroStage(status))
    return { status: "error", message: "Select a valid stage." };
  if (partyAContactId === partyBContactId)
    return { status: "error", message: "Pick two different guests." };

  const error = await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) return "Event not found in this organization.";

    // Sequential: one pooled connection per tx, so no concurrent queries.
    const a = await tx.contact.findUnique({ where: { id: partyAContactId } });
    const b = await tx.contact.findUnique({ where: { id: partyBContactId } });
    if (!a || !b) return "A guest is not a contact in this organization.";

    await tx.introduction.create({
      data: {
        orgId,
        partyAContactId,
        partyBContactId,
        status,
        source: "manual",
        eventId,
        madeOn,
        ownerUserId: userId,
      },
    });
    return null;
  });

  if (error) return { status: "error", message: error };

  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath("/dashboard/introductions");
  return { status: "saved" };
}
