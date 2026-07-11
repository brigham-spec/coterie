"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { getStageDef } from "@/lib/project-stages";
import {
  generateProfileSynthesis,
  type ProfileSynthesis,
  type SynthEvidence,
} from "@/lib/profile-synth";

// Batch profile synthesis (gap-audit cluster E, ported from the prototype's
// synthesizeProfile + showBatchSynthModal, Coterie.html:9029 / 11668). The
// companies-list "Synthesize profiles" panel runs this once per selected member;
// each call re-loads EVERYTHING that member's relationship touched — meetings,
// event-conversation notes, introductions, open + completed commitments, saved
// articles, and active projects — withOrg-scoped from the id (RLS → a foreign id
// resolves null → refused), then asks the engine to propose structured-field
// updates. The Anthropic call runs server-side in @/lib/profile-synth; the key
// never reaches the browser. Ephemeral: the result is only proposed here —
// nothing is written until the operator applies selected fields below.

// How much of each evidence source to feed the model. Bounded so the prompt stays
// tight and the run is cheap even across a batch.
const MEETING_TAKE = 8;
const ACTION_ITEM_TAKE = 10;
const EVENT_NOTE_TAKE = 6;
const INTRO_TAKE = 8;
const ARTICLE_TAKE = 8;
const PROJECT_TAKE = 8;

export type SynthResult =
  | { status: "ok"; synthesis: ProfileSynthesis }
  | { status: "empty" }
  | { status: "error"; message: string };

// PURE: one-line label for the counterpart of an introduction, plus its outcome
// or stage, so the model sees who this member was connected to and what came of
// it without needing the relational graph.
function introLine(
  counterpart: string,
  outcome: string | null,
  status: string,
): string {
  const who = counterpart || "an unnamed contact";
  if (outcome && outcome.trim() !== "") return `Intro to ${who} → ${outcome.trim()}`;
  return `Intro to ${who} (${status})`;
}

export async function synthesizeCompany(companyId: string): Promise<SynthResult> {
  const id = String(companyId ?? "").trim();
  if (!id) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id },
      select: {
        name: true,
        industry: true,
        status: true,
        lookingFor: true,
        canOffer: true,
        counties: true,
        agencyContacts: true,
        dealSize: true,
        notes: true,
        contacts: {
          select: { id: true, name: true, isPrimary: true },
          orderBy: { name: "asc" },
        },
      },
    });
    if (company == null) return null;

    // This member's people — the join key for meetings, event notes, and intros.
    const contactIds = company.contacts.map((c) => c.id);
    const contactIdSet = new Set(contactIds);

    // Meetings this member's contacts attended, freshest first.
    const attendances = contactIds.length
      ? await tx.meetingAttendee.findMany({
          where: { contactId: { in: contactIds } },
          select: { meetingId: true },
        })
      : [];
    const meetingIds = [...new Set(attendances.map((a) => a.meetingId))];
    const meetings = meetingIds.length
      ? await tx.meeting.findMany({
          where: { id: { in: meetingIds } },
          orderBy: { heldAt: "desc" },
          take: MEETING_TAKE,
          select: { heldAt: true, title: true, summary: true },
        })
      : [];

    // Open + completed commitments on those meetings — split by status below.
    const actionItems = meetingIds.length
      ? await tx.actionItem.findMany({
          where: { meetingId: { in: meetingIds }, status: { in: ["open", "done"] } },
          orderBy: { createdAt: "desc" },
          take: ACTION_ITEM_TAKE,
          select: { text: true, status: true },
        })
      : [];

    // Event-conversation notes captured against this member's contacts.
    const eventInvitees = contactIds.length
      ? await tx.eventInvitee.findMany({
          where: { contactId: { in: contactIds }, NOT: { notes: "" } },
          orderBy: { createdAt: "desc" },
          take: EVENT_NOTE_TAKE,
          select: { notes: true, event: { select: { name: true } } },
        })
      : [];

    // Introductions this member's contacts were party to (either side), with the
    // counterpart's name so the model reads who they were connected to.
    const intros = contactIds.length
      ? await tx.introduction.findMany({
          where: {
            OR: [
              { partyAContactId: { in: contactIds } },
              { partyBContactId: { in: contactIds } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: INTRO_TAKE,
          select: {
            status: true,
            outcome: true,
            partyAContactId: true,
            partyBContactId: true,
            partyA: { select: { name: true } },
            partyB: { select: { name: true } },
          },
        })
      : [];

    // Saved articles / research captured against this company.
    const articles = await tx.newsItem.findMany({
      where: { companyId: id },
      orderBy: { capturedAt: "desc" },
      take: ARTICLE_TAKE,
      select: { headline: true, summary: true },
    });

    // Active projects this member is linked to — read-only context (folded into
    // notesAppend by the engine, never a standalone field).
    const projectLinks = await tx.projectLink.findMany({
      where: { companyId: id },
      take: PROJECT_TAKE,
      select: { project: { select: { name: true, stage: true } } },
    });

    return {
      company,
      contactIdSet,
      meetings,
      actionItems,
      eventInvitees,
      intros,
      articles,
      projectLinks,
    };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };

  const evidence: SynthEvidence = {
    meetings: data.meetings.map((m) => ({
      date: m.heldAt.toISOString().slice(0, 10),
      title: m.title,
      summary: m.summary ?? "",
    })),
    eventNotes: data.eventInvitees.map((e) =>
      e.event?.name ? `${e.event.name}: ${e.notes}` : e.notes,
    ),
    intros: data.intros.map((i) => {
      // The counterpart is whichever party is NOT one of this member's contacts.
      const counterpart = data.contactIdSet.has(i.partyAContactId)
        ? i.partyB.name
        : i.partyA.name;
      return introLine(counterpart, i.outcome, i.status);
    }),
    openItems: data.actionItems.filter((a) => a.status === "open").map((a) => a.text),
    doneItems: data.actionItems.filter((a) => a.status === "done").map((a) => a.text),
    articles: data.articles.map((a) =>
      a.summary ? `${a.headline} — ${a.summary}` : a.headline,
    ),
    projects: data.projectLinks.map(
      (l) => `${l.project.name} (${getStageDef(l.project.stage).label})`,
    ),
  };

  // Nothing to synthesize from → tell the caller so it can show an empty state
  // without burning an AI call.
  const hasEvidence =
    evidence.meetings.length > 0 ||
    evidence.eventNotes.length > 0 ||
    evidence.intros.length > 0 ||
    evidence.openItems.length > 0 ||
    evidence.doneItems.length > 0 ||
    evidence.articles.length > 0 ||
    evidence.projects.length > 0;
  if (!hasEvidence) return { status: "empty" };

  try {
    await enforceAiRateLimit(orgId);
    const synthesis = await generateProfileSynthesis(
      {
        name: data.company.name,
        contactName:
          data.company.contacts.find((c) => c.isPrimary)?.name ??
          data.company.contacts[0]?.name ??
          "",
        industry: data.company.industry,
        status: data.company.status,
        lookingFor: data.company.lookingFor ?? "",
        canOffer: data.company.canOffer ?? "",
        counties: data.company.counties,
        agencyContacts: data.company.agencyContacts ?? "",
        dealSize: data.company.dealSize ?? "",
        notes: data.company.notes,
      },
      evidence,
    );
    if (synthesis == null) return { status: "empty" };
    return { status: "ok", synthesis };
  } catch (err) {
    console.error("profile synthesis failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not synthesize this profile. Try again." };
  }
}

// Apply the operator's selected synthesis fields to the company row. The client
// posts ONLY the fields the operator checked; we coerce defensively, re-verify
// the company inside withOrg (RLS → a foreign id resolves null → refused), and
// write only the provided values. `counties` is MERGED into the existing array
// (deduped, case-insensitive) so we only ever add. `notesAppend` is appended
// (never overwrites) with a dated "[Synthesized]" header so provenance is visible.

export type ApplySynthResult =
  | { status: "applied"; count: number }
  | { status: "error"; message: string };

type SynthSelection = {
  lookingFor?: string;
  canOffer?: string;
  counties?: string;
  agencyContacts?: string;
  dealSize?: string;
  notesAppend?: string;
};

// PURE: keep only non-empty string values for the six writable fields. Anything
// malformed collapses to {}.
function readSynthSelection(raw: unknown): SynthSelection {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const pick = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? undefined : t.slice(0, max);
  };
  const selection: SynthSelection = {};
  const lookingFor = pick(obj.lookingFor, 240);
  const canOffer = pick(obj.canOffer, 240);
  const counties = pick(obj.counties, 200);
  const agencyContacts = pick(obj.agencyContacts, 240);
  const dealSize = pick(obj.dealSize, 120);
  const notesAppend = pick(obj.notesAppend, 500);
  if (lookingFor !== undefined) selection.lookingFor = lookingFor;
  if (canOffer !== undefined) selection.canOffer = canOffer;
  if (counties !== undefined) selection.counties = counties;
  if (agencyContacts !== undefined) selection.agencyContacts = agencyContacts;
  if (dealSize !== undefined) selection.dealSize = dealSize;
  if (notesAppend !== undefined) selection.notesAppend = notesAppend;
  return selection;
}

export async function applyCompanySynthesis(
  companyId: string,
  rawSelection: unknown,
): Promise<ApplySynthResult> {
  const id = String(companyId ?? "").trim();
  if (!id) return { status: "error", message: "missing company" };

  const selection = readSynthSelection(rawSelection);
  const count =
    (selection.lookingFor !== undefined ? 1 : 0) +
    (selection.canOffer !== undefined ? 1 : 0) +
    (selection.counties !== undefined ? 1 : 0) +
    (selection.agencyContacts !== undefined ? 1 : 0) +
    (selection.dealSize !== undefined ? 1 : 0) +
    (selection.notesAppend !== undefined ? 1 : 0);
  if (count === 0)
    return { status: "error", message: "Nothing selected to apply." };

  const { orgId } = await requireOrgContext();

  const applied = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id },
      select: { notes: true, counties: true },
    });
    if (company == null) return false;

    const data: {
      lookingFor?: string;
      canOffer?: string;
      counties?: string[];
      agencyContacts?: string;
      dealSize?: string;
      notes?: string;
    } = {};
    if (selection.lookingFor !== undefined) data.lookingFor = selection.lookingFor;
    if (selection.canOffer !== undefined) data.canOffer = selection.canOffer;
    if (selection.agencyContacts !== undefined)
      data.agencyContacts = selection.agencyContacts;
    if (selection.dealSize !== undefined) data.dealSize = selection.dealSize;
    if (selection.counties !== undefined) {
      // Merge the proposed comma-list into the existing counties, deduped
      // case-insensitively, preserving the existing order then appending new ones.
      const seen = new Set(company.counties.map((c) => c.toLowerCase()));
      const merged = [...company.counties];
      for (const raw of selection.counties.split(",")) {
        const c = raw.trim();
        if (c !== "" && !seen.has(c.toLowerCase())) {
          seen.add(c.toLowerCase());
          merged.push(c);
        }
      }
      data.counties = merged;
    }
    if (selection.notesAppend !== undefined) {
      const stamp = new Date().toISOString().slice(0, 10);
      const header = `[Synthesized, ${stamp}]: ${selection.notesAppend}`;
      data.notes = company.notes ? `${company.notes}\n\n${header}` : header;
    }

    await tx.company.update({ where: { id }, data });
    return true;
  });

  if (!applied)
    return { status: "error", message: "company not found in this organization" };

  revalidatePath(`/dashboard/companies/${id}`);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
  return { status: "applied", count };
}
