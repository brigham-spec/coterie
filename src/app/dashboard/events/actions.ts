"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import {
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
  const dateRaw = String(formData.get("date") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const theme = String(formData.get("theme") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();

  if (!name || !type) throw new Error("name and type are required");
  if (!isEventType(type)) throw new Error("invalid event type");
  // stage is optional (defaults to "planning"); if supplied it must be in vocabulary.
  if (stage !== "" && !isEventStage(stage))
    throw new Error("invalid event stage");
  if (capacityRaw !== "" && !Number.isInteger(Number(capacityRaw)))
    throw new Error("capacity must be a whole number");

  await withOrg(orgId, (tx) =>
    tx.event.create({
      data: {
        orgId,
        name,
        type,
        stage: stage === "" ? "planning" : stage,
        date: dateRaw === "" ? null : new Date(dateRaw),
        venue: venue === "" ? null : venue,
        theme: theme === "" ? null : theme,
        description,
        capacity: capacityRaw === "" ? null : Number(capacityRaw),
      },
    }),
  );

  revalidatePath("/dashboard/events");
}

// Advance (or correct) an event's stage. The findUnique runs inside withOrg
// (RLS-scoped), so a foreign eventId resolves to null and is refused; the update is
// likewise scoped, needing no separate ownership re-check.
export async function updateEventStage(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  if (!eventId || !stage) throw new Error("event and stage are required");
  if (!isEventStage(stage)) throw new Error("invalid event stage");

  await withOrg(orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new Error("event not found");
    await tx.event.update({ where: { id: eventId }, data: { stage } });
  });

  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
}

// Add a guest to an event — either a CRM contact (contactId) or an external guest
// (externalName). The event's composite FK keeps the invitee in the event's org;
// a supplied contactId is re-checked inside withOrg (RLS-scoped → null if foreign)
// so a cross-org contact can't be attached.
export async function addInvitee(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const eventId = String(formData.get("eventId") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();
  const externalName = String(formData.get("externalName") ?? "").trim();
  const externalOrg = String(formData.get("externalOrg") ?? "").trim();
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

  // Only brief guests who'll be in the room. External guests have no CRM profile to
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
    // Every company that has ever appeared on a guest list (via a CRM contact) —
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
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not suggest events. Try again." };
  }
}
