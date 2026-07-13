"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { isIntroStage } from "@/lib/intro-stages";
import { getStageDef, TERMINAL_STAGES } from "@/lib/project-stages";
import { NETWORK_STATUSES, isCompanyStatus } from "@/lib/company-statuses";
import { isProposalStatus } from "@/lib/proposal-statuses";
import { isValueKind } from "@/lib/value-kinds";
import { ORG_TAGS } from "@/lib/tags";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import { generateCompanyBrief } from "@/lib/anthropic";
import { generateMeetingPrep, type PrepCommitment } from "@/lib/meeting-prep";
import {
  generateProfileEnrichment,
  type EnrichMeeting,
  type ProfileEnrichment,
} from "@/lib/enrich-meetings";
import {
  generateWhyJoinPitch,
  type PitchMember,
  type WhyJoinPitch,
} from "@/lib/why-join";
import {
  generatePartnerSynthesis,
  type PartnerSynthesis,
} from "@/lib/partner-synth";
import {
  eligibleCandidateIds,
  generateIntroSuggestions,
  type IntroSuggestion,
} from "@/lib/intro-engine";
import { introProfileInclude, toIntroProfile } from "@/lib/intro-profile";

// AI company brief (build item 5). The company is re-loaded withOrg-scoped from
// the id in the form (never trusting a client-passed payload), so a foreign id
// resolves null → we never brief another tenant's company. The Anthropic call
// happens server-side in @/lib/anthropic; the key never reaches the browser.
//
// This is a useActionState action: it returns state rather than throwing, so
// model/network failures render inline instead of tripping the error boundary.
// Nothing is persisted — the brief is ephemeral (no schema field for it yet).

export type BriefState =
  | { status: "idle" }
  | { status: "ok"; brief: string }
  | { status: "error"; message: string };

export async function generateBrief(
  _prev: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const company = await withOrg(orgId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      include: {
        contacts: { orderBy: { name: "asc" }, select: { name: true, title: true } },
        projectLinks: {
          orderBy: { role: "asc" },
          include: { project: { select: { name: true, stage: true } } },
        },
      },
    }),
  );

  if (company == null)
    return { status: "error", message: "company not found in this organization" };

  try {
    await enforceAiRateLimit(orgId);
    const brief = await generateCompanyBrief({
      name: company.name,
      status: company.status,
      industry: company.industry,
      tier: company.tier,
      annualValue:
        company.annualValue == null ? null : String(company.annualValue),
      temperature: company.temperature,
      source: company.source,
      emailDomain: company.emailDomain,
      website: company.website,
      notes: company.notes,
      contacts: company.contacts.map((c) => ({ name: c.name, title: c.title })),
      projects: company.projectLinks.map((l) => ({
        name: l.project.name,
        stage: l.project.stage,
        role: l.role,
      })),
    });
    return { status: "ok", brief };
  } catch (err) {
    // Surface a friendly message; log the real cause server-side for triage.
    console.error("brief generation failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not generate a brief. Try again." };
  }
}

// Per-member intro suggestions (slice 11.4b). The focus company and the candidate
// pool are re-loaded withOrg-scoped from the id in the form (never trusting a
// client payload), so a foreign id resolves null and no other tenant's network is
// scanned. Companies already introduced to the focus (via any contact pair) are
// excluded before the model sees the pool. Ephemeral — nothing is persisted.
// The profile shaping (introProfileInclude / toIntroProfile) is shared with the
// dashboard's proactive scan via @/lib/intro-profile.

export type IntroSuggestState =
  | { status: "idle" }
  | { status: "ok"; suggestions: IntroSuggestion[] }
  | { status: "error"; message: string };

export async function suggestIntros(
  _prev: IntroSuggestState,
  formData: FormData,
): Promise<IntroSuggestState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const focus = await tx.company.findUnique({
      where: { id: companyId },
      include: introProfileInclude,
    });
    if (focus == null) return null;

    const companies = await tx.company.findMany({
      include: introProfileInclude,
    });
    const intros = await tx.introduction.findMany({
      select: {
        partyA: { select: { companyId: true } },
        partyB: { select: { companyId: true } },
      },
    });
    // Durable dismissals touching the focus, either orientation (slice 11.4c) —
    // a pairing the user has waved off should not resurface on the next scan.
    const dismissals = await tx.introDismissal.findMany({
      where: {
        OR: [{ focusCompanyId: companyId }, { candidateCompanyId: companyId }],
      },
      select: { focusCompanyId: true, candidateCompanyId: true },
    });
    return { focus, companies, intros, dismissals };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };

  // Companies excluded from the pool: already introduced to the focus (either
  // direction, any contact pair) OR dismissed against it (either orientation).
  const excluded = new Set<string>();
  for (const i of data.intros) {
    if (i.partyA.companyId === companyId) excluded.add(i.partyB.companyId);
    if (i.partyB.companyId === companyId) excluded.add(i.partyA.companyId);
  }
  for (const d of data.dismissals) {
    if (d.focusCompanyId === companyId) excluded.add(d.candidateCompanyId);
    if (d.candidateCompanyId === companyId) excluded.add(d.focusCompanyId);
  }

  const eligible = new Set(
    eligibleCandidateIds(
      companyId,
      data.companies.map((c) => c.id),
      excluded,
    ),
  );
  const candidates = data.companies
    .filter((c) => eligible.has(c.id))
    .map(toIntroProfile);

  try {
    await enforceAiRateLimit(orgId);
    const suggestions = await generateIntroSuggestions(
      toIntroProfile(data.focus),
      candidates,
    );
    return { status: "ok", suggestions };
  } catch (err) {
    console.error("intro suggestions failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not generate suggestions. Try again." };
  }
}

// Persist a "don't suggest this pairing again" decision (slice 11.4c). The pair is
// stored directionally (focus → candidate); suggestIntros excludes either
// orientation on the next scan. Both companies are re-verified withOrg-scoped
// (RLS → a foreign id resolves null → refused) before writing, and the write is an
// idempotent upsert on the unique pair so re-dismissing is a no-op.
export async function dismissIntro(
  focusCompanyId: string,
  candidateCompanyId: string,
): Promise<void> {
  const focus = String(focusCompanyId ?? "").trim();
  const candidate = String(candidateCompanyId ?? "").trim();
  if (!focus || !candidate || focus === candidate) return;

  const { orgId } = await requireOrgContext();

  await withOrg(orgId, async (tx) => {
    // Sequential: one pooled connection per tx, so no concurrent queries.
    const f = await tx.company.findUnique({ where: { id: focus }, select: { id: true } });
    const c = await tx.company.findUnique({ where: { id: candidate }, select: { id: true } });
    if (!f || !c) throw new Error("company not found in this organization");

    await tx.introDismissal.upsert({
      where: {
        orgId_focusCompanyId_candidateCompanyId: {
          orgId,
          focusCompanyId: focus,
          candidateCompanyId: candidate,
        },
      },
      create: { orgId, focusCompanyId: focus, candidateCompanyId: candidate },
      update: {},
    });
  });
}

// Pre-meeting brief (gap-audit cluster A). The company is re-loaded withOrg-scoped
// from the id in the form (never a client payload), so a foreign id resolves null
// and no other tenant's relationship is prepped. Around it we gather the meetings
// this company's contacts attended and the still-open commitments on those
// meetings — the grounding the two-sentence prep note is written from. The
// Anthropic call runs server-side in @/lib/meeting-prep; the key never reaches the
// browser. Ephemeral: nothing is persisted (no schema field for it).

export type MeetingPrepState =
  | { status: "idle" }
  | { status: "ok"; prep: string }
  | { status: "error"; message: string };

export async function generateMeetingPrepAction(
  _prev: MeetingPrepState,
  formData: FormData,
): Promise<MeetingPrepState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId, userName } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      include: {
        contacts: {
          select: { id: true, name: true, title: true },
          orderBy: { name: "asc" },
        },
        projectLinks: {
          orderBy: { role: "asc" },
          include: { project: { select: { name: true, stage: true } } },
        },
      },
    });
    if (company == null) return null;

    // Meetings this company's people attended — the freshest first — plus the
    // open commitments recorded on those meetings. Both are scoped to this
    // company's contacts, so the prep is grounded in this relationship only.
    const contactIds = company.contacts.map((c) => c.id);
    const attendances = contactIds.length
      ? await tx.meetingAttendee.findMany({
          where: { contactId: { in: contactIds } },
          select: { meetingId: true },
        })
      : [];
    const meetingIds = [...new Set(attendances.map((a) => a.meetingId))];

    const recentMeetings = meetingIds.length
      ? await tx.meeting.findMany({
          where: { id: { in: meetingIds } },
          orderBy: { heldAt: "desc" },
          take: 3,
          select: { title: true, heldAt: true, summary: true },
        })
      : [];

    const openCommitments = meetingIds.length
      ? await tx.actionItem.findMany({
          where: { status: "open", meetingId: { in: meetingIds } },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { text: true, ownerUserId: true, ownerContactId: true },
        })
      : [];

    return { company, recentMeetings, openCommitments };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };

  const commitments: PrepCommitment[] = data.openCommitments.map((c) => ({
    text: c.text,
    // Staff-owned ("we owe") vs contact-owned ("they owe"); the owner-XOR CHECK
    // guarantees exactly one is set, so a null ownerUserId means the contact owns it.
    owedBy: c.ownerUserId != null ? "us" : "them",
  }));

  try {
    await enforceAiRateLimit(orgId);
    const prep = await generateMeetingPrep({
      userName,
      company: {
        name: data.company.name,
        status: data.company.status,
        industry: data.company.industry,
        tier: data.company.tier,
        lookingFor: data.company.lookingFor,
        canOffer: data.company.canOffer,
        notes: data.company.notes,
        contacts: data.company.contacts.map((c) => ({
          name: c.name,
          title: c.title,
        })),
        projects: data.company.projectLinks.map((l) => ({
          name: l.project.name,
          stage: l.project.stage,
          role: l.role,
        })),
      },
      recentMeetings: data.recentMeetings.map((m) => ({
        title: m.title,
        heldAt: m.heldAt.toISOString().slice(0, 10),
        summary: m.summary,
      })),
      openCommitments: commitments,
    });
    return { status: "ok", prep };
  } catch (err) {
    console.error("meeting prep failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not prepare a brief. Try again." };
  }
}

// Confirm a pending intro-advance detection from a company profile (gap-audit
// cluster A). The proposal is only evidence a meeting happened; the stage never
// moves until a human confirms here. The introduction is re-loaded withOrg-scoped
// from the id in the form (RLS → a foreign id resolves null → refused), and only
// its status advances — an existing outcome note is left untouched (unlike the
// ledger's updateIntroduction). Both the ledger and this company page are
// revalidated so the pending count and lists refresh.
export async function confirmIntroAdvance(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const introId = String(formData.get("introId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!introId || !status)
    throw new Error("introduction and status are required");
  if (!isIntroStage(status)) throw new Error("invalid introduction status");

  await withOrg(orgId, async (tx) => {
    const intro = await tx.introduction.findUnique({ where: { id: introId } });
    if (!intro) throw new Error("introduction not found in this organization");

    await tx.introduction.update({ where: { id: introId }, data: { status } });
  });

  revalidatePath("/dashboard/introductions");
  if (companyId) revalidatePath(`/dashboard/companies/${companyId}`);
}

// Why-join membership pitch (gap-audit cluster E). Written for a prospect: the
// prospect and the network it would be joining are re-loaded withOrg-scoped from
// the id in the form (never a client payload), so a foreign id resolves null and
// no other tenant's network is pitched. The grounding — current members to
// introduce, the sector's representation, and active-project opportunities — is
// assembled here so the engine cites real members and projects by name. The
// Anthropic call runs server-side in @/lib/why-join; the key never reaches the
// browser. Ephemeral: nothing is persisted.

export type WhyJoinState =
  | { status: "idle" }
  | { status: "ok"; pitch: WhyJoinPitch }
  | { status: "error"; message: string };

export async function generateWhyJoin(
  _prev: WhyJoinState,
  formData: FormData,
): Promise<WhyJoinState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId, orgName, userName } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const prospect = await tx.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        industry: true,
        lookingFor: true,
        canOffer: true,
        notes: true,
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: { name: true },
        },
      },
    });
    if (prospect == null) return null;

    // Current network members the prospect could be introduced to on day one.
    const members = await tx.company.findMany({
      where: {
        status: { in: [...NETWORK_STATUSES] },
        id: { not: companyId },
      },
      orderBy: { name: "asc" },
      take: 40,
      select: {
        name: true,
        industry: true,
        lookingFor: true,
        canOffer: true,
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: { name: true },
        },
      },
    });

    // Active projects → open-opportunity descriptors for the prospect's expertise.
    const projects = await tx.project.findMany({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { name: true, stage: true, type: true },
    });

    return { prospect, members, projects };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };

  const memberCount = data.members.length;
  const sameSector = data.prospect.industry
    ? data.members.filter((m) => m.industry === data.prospect.industry).length
    : 0;
  const industryPresence = data.prospect.industry
    ? `${sameSector} of ${memberCount} members work in ${data.prospect.industry}`
    : "sector not specified on this prospect";

  const openRoles = data.projects.map(
    (p) =>
      `${p.name} (${getStageDef(p.stage).label}${p.type ? `, ${p.type}` : ""})`,
  );

  const members: PitchMember[] = data.members.map((m) => ({
    // Prefer the primary contact as the named person; the company is their org.
    name: m.contacts[0]?.name ?? m.name,
    org: m.contacts[0] ? m.name : null,
    industry: m.industry,
    seeking: m.lookingFor,
    brings: m.canOffer,
  }));

  try {
    await enforceAiRateLimit(orgId);
    const pitch = await generateWhyJoinPitch({
      orgName,
      host: userName,
      prospect: {
        name: data.prospect.name,
        org: data.prospect.name,
        industry: data.prospect.industry,
        seeking: data.prospect.lookingFor,
        brings: data.prospect.canOffer,
        notes: data.prospect.notes,
      },
      memberCount,
      industryPresence,
      openRoles,
      members,
    });
    if (pitch == null)
      return { status: "error", message: "Could not write a pitch. Try again." };
    return { status: "ok", pitch };
  } catch (err) {
    console.error("why-join pitch failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not write a pitch. Try again." };
  }
}

// Enrich-from-meetings (gap-audit cluster E). The company is re-loaded
// withOrg-scoped from the id in the form (never a client payload), so a foreign
// id resolves null and no other tenant's meetings are read. Around it we gather
// the meetings this company's contacts attended (freshest first) and the open +
// closed action items on those meetings — the evidence the enrichment is drawn
// from. The Anthropic call runs server-side in @/lib/enrich-meetings; the key
// never reaches the browser. Ephemeral: the result is only proposed here —
// nothing is written until the operator applies selected fields below.

export type EnrichMeetingsState =
  | { status: "idle" }
  | { status: "ok"; enrichment: ProfileEnrichment }
  | { status: "error"; message: string };

const ENRICH_MEETING_TAKE = 6;
const ENRICH_ACTION_ITEM_TAKE = 3;

export async function enrichFromMeetingsAction(
  _prev: EnrichMeetingsState,
  formData: FormData,
): Promise<EnrichMeetingsState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        industry: true,
        lookingFor: true,
        canOffer: true,
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: { name: true },
        },
      },
    });
    if (company == null) return null;

    // Every contact at this company, then the meetings they attended — scoped to
    // this relationship so the enrichment is grounded in this member only.
    const contacts = await tx.contact.findMany({
      where: { companyId },
      select: { id: true },
    });
    const contactIds = contacts.map((c) => c.id);
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
          take: ENRICH_MEETING_TAKE,
          select: { id: true, title: true, heldAt: true, summary: true },
        })
      : [];

    // The action items recorded on those meetings, folded back onto each meeting
    // as extra evidence. A few per meeting keeps the prompt bounded.
    const items = meetings.length
      ? await tx.actionItem.findMany({
          where: { meetingId: { in: meetings.map((m) => m.id) } },
          orderBy: { createdAt: "desc" },
          select: { meetingId: true, text: true },
        })
      : [];

    return { company, meetings, items };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };
  if (data.meetings.length === 0)
    return { status: "error", message: "No synced meetings found for this member yet." };

  const itemsByMeeting = new Map<string, string[]>();
  for (const it of data.items) {
    if (it.meetingId == null) continue;
    const list = itemsByMeeting.get(it.meetingId) ?? [];
    if (list.length < ENRICH_ACTION_ITEM_TAKE) list.push(it.text);
    itemsByMeeting.set(it.meetingId, list);
  }

  const meetings: EnrichMeeting[] = data.meetings.map((m) => ({
    date: m.heldAt.toISOString().slice(0, 10),
    title: m.title,
    summary: m.summary ?? "",
    actionItems: itemsByMeeting.get(m.id) ?? [],
  }));

  try {
    await enforceAiRateLimit(orgId);
    const enrichment = await generateProfileEnrichment(
      {
        orgName: data.company.name,
        contactName: data.company.contacts[0]?.name ?? "",
        industry: data.company.industry,
        lookingFor: data.company.lookingFor ?? "",
        canOffer: data.company.canOffer ?? "",
      },
      meetings,
    );
    if (enrichment == null)
      return {
        status: "error",
        message: "No new profile details found in recent meetings.",
      };
    return { status: "ok", enrichment };
  } catch (err) {
    console.error("meeting enrichment failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not enrich from meetings. Try again." };
  }
}

// Apply the operator's selected enrichment fields to the company row (gap-audit
// cluster E). The client posts a hidden JSON payload of ONLY the fields the
// operator checked; we coerce it defensively, re-verify the company inside
// withOrg (RLS → a foreign id resolves null → refused), and write only the
// provided scalars. `notesAppend` is appended (never overwrites) to the existing
// notes with a dated "[Meetings]" header so the provenance is visible. Returns
// the number of fields applied so the UI can confirm.

export type ApplyEnrichmentState =
  | { status: "idle" }
  | { status: "applied"; count: number }
  | { status: "error"; message: string };

type EnrichmentSelection = {
  lookingFor?: string;
  canOffer?: string;
  industry?: string;
  notesAppend?: string;
};

// PURE: read the client's selection payload, keeping only non-empty string
// values for the four writable fields. Anything malformed collapses to {}.
function readEnrichmentSelection(raw: string): EnrichmentSelection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const obj = parsed as Record<string, unknown>;
  const pick = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? undefined : t.slice(0, max);
  };
  const selection: EnrichmentSelection = {};
  const lookingFor = pick(obj.lookingFor, 200);
  const canOffer = pick(obj.canOffer, 200);
  const industry = pick(obj.industry, 80);
  const notesAppend = pick(obj.notesAppend, 500);
  if (lookingFor !== undefined) selection.lookingFor = lookingFor;
  if (canOffer !== undefined) selection.canOffer = canOffer;
  if (industry !== undefined) selection.industry = industry;
  if (notesAppend !== undefined) selection.notesAppend = notesAppend;
  return selection;
}

export async function applyMeetingEnrichment(
  _prev: ApplyEnrichmentState,
  formData: FormData,
): Promise<ApplyEnrichmentState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const selection = readEnrichmentSelection(
    String(formData.get("enrichment") ?? ""),
  );
  const count =
    (selection.lookingFor !== undefined ? 1 : 0) +
    (selection.canOffer !== undefined ? 1 : 0) +
    (selection.industry !== undefined ? 1 : 0) +
    (selection.notesAppend !== undefined ? 1 : 0);
  if (count === 0)
    return { status: "error", message: "Nothing selected to apply." };

  const { orgId } = await requireOrgContext();

  const applied = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { notes: true },
    });
    if (company == null) return false;

    const data: {
      lookingFor?: string;
      canOffer?: string;
      industry?: string;
      notes?: string;
    } = {};
    if (selection.lookingFor !== undefined) data.lookingFor = selection.lookingFor;
    if (selection.canOffer !== undefined) data.canOffer = selection.canOffer;
    if (selection.industry !== undefined) data.industry = selection.industry;
    if (selection.notesAppend !== undefined) {
      const stamp = new Date().toISOString().slice(0, 10);
      const header = `[Meetings, ${stamp}]: ${selection.notesAppend}`;
      data.notes = company.notes ? `${company.notes}\n\n${header}` : header;
    }

    await tx.company.update({ where: { id: companyId }, data });
    return true;
  });

  if (!applied)
    return { status: "error", message: "company not found in this organization" };

  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
  return { status: "applied", count };
}

// ── P1: editable profile + lifecycle ────────────────────────────────────────
// The company detail page is otherwise read-only; these two actions make the
// Details card editable and drive the prospect → member → former lifecycle.
// Both re-load the company inside withOrg, so a forged/foreign id resolves null
// and RLS refuses the write. Every status transition is recorded as an Activity
// so the relationship timeline reflects the lifecycle (mirrors the prototype's
// statusHistory). org_id and the acting user are stamped from the resolved
// context, never from client input.

const ORG_TAG_KEYS = new Set(ORG_TAGS.map((t) => t.key));

function optionalText(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

function optionalInt(formData: FormData, key: string): number | null {
  const v = String(formData.get(key) ?? "").trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return Math.trunc(n);
}

export async function updateCompany(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const status = String(formData.get("status") ?? "").trim();
  if (!isCompanyStatus(status)) throw new Error("invalid company status");

  const industry = String(formData.get("industry") ?? "").trim();
  if (!industry) throw new Error("industry is required");

  // annualValue is a Decimal column, so it bypasses optionalInt (which truncates
  // to an integer): keep the raw string and let Prisma coerce, defaulting empty
  // to "0" since the column is non-null.
  const annualValueRaw = String(formData.get("annualValue") ?? "").trim();
  const annualValue = annualValueRaw === "" ? "0" : annualValueRaw;
  if (Number.isNaN(Number(annualValue)))
    throw new Error("annualValue must be a number");

  const temperature = optionalInt(formData, "temperature");
  if (temperature !== null && (temperature < 0 || temperature > 100))
    throw new Error("temperature must be between 0 and 100");

  // counties: comma-separated free text → trimmed, de-duped list (prototype UX).
  const counties = [
    ...new Set(
      String(formData.get("counties") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];

  // networkTags: checkbox group → only known org-tag keys survive.
  const networkTags = formData
    .getAll("networkTags")
    .map((t) => String(t))
    .filter((t) => ORG_TAG_KEYS.has(t));

  // ownerUserId: the account owner (this org's staff member responsible for the
  // relationship). Blank clears it; a set value must be a member of THIS org.
  // org_memberships carry no RLS, so scope the check explicitly by (org, user) —
  // this refuses assigning a company to another tenant's user.
  const ownerUserId = optionalText(formData, "ownerUserId");
  if (ownerUserId !== null) {
    const membership = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: ownerUserId } },
      select: { userId: true },
    });
    if (membership == null)
      throw new Error("owner is not a member of this organization");
  }

  const data = {
    status,
    industry,
    annualValue,
    tier: optionalText(formData, "tier"),
    temperature,
    website: optionalText(formData, "website"),
    emailDomain: optionalText(formData, "emailDomain"),
    source: optionalText(formData, "source"),
    memberSince: optionalInt(formData, "memberSince"),
    dealSize: optionalText(formData, "dealSize"),
    lookingFor: optionalText(formData, "lookingFor"),
    canOffer: optionalText(formData, "canOffer"),
    agencyContacts: optionalText(formData, "agencyContacts"),
    notes: String(formData.get("notes") ?? "").trim(),
    counties,
    networkTags,
    ownerUserId,
  };

  const ok = await withOrg(orgId, async (tx) => {
    const current = await tx.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (current == null) return false;

    await tx.company.update({ where: { id: companyId }, data });

    if (current.status !== status) {
      await tx.activity.create({
        data: {
          orgId,
          companyId,
          actorUserId: userId,
          type: ACTIVITY_STATUS_CHANGED,
          payload: { from: current.status, to: status },
          occurredAt: new Date(),
        },
      });
    }
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");

  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}

// ── P3: membership proposals ledger ─────────────────────────────────────────
// The profile's Proposals card logs and tracks membership offers. Each write
// re-loads the parent company (create) or the proposal itself (update/delete)
// inside withOrg — a foreign id resolves null under RLS and the write is refused.
// Winning a proposal nudges a prospect into membership (mirrors the prototype),
// journaled as a status_changed Activity so the timeline reflects the close.

function revalidateProposal(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/revenue");
  revalidatePath("/dashboard");
}

// Optional YYYY-MM-DD date field → Date or null.
function optionalDate(formData: FormData, key: string): Date | null {
  const v = String(formData.get(key) ?? "").trim();
  if (v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`${key} is not a valid date`);
  return d;
}

// Optional decimal money field → string (Prisma coerces) or null.
function optionalAmount(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  if (v === "") return null;
  if (Number.isNaN(Number(v))) throw new Error(`${key} must be a number`);
  return v;
}

export async function createProposal(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const tier = String(formData.get("tier") ?? "").trim();
  if (!tier) throw new Error("tier is required");

  const status = String(formData.get("status") ?? "draft").trim() || "draft";
  if (!isProposalStatus(status)) throw new Error("invalid proposal status");

  const amount = optionalAmount(formData, "amount");
  const sentOn = optionalDate(formData, "sentOn");
  const driveUrl = optionalText(formData, "driveUrl");
  const notes = String(formData.get("notes") ?? "").trim();

  const ok = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (company == null) return false;

    await tx.membershipProposal.create({
      data: { orgId, companyId, tier, amount, status, sentOn, driveUrl, notes },
    });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");
  revalidateProposal(companyId);
}

// Move a proposal along the pipeline. Any status change also stamps
// lastFollowUpAt so the follow-up nudge treats it as freshly touched. Winning a
// proposal converts a prospect company to member (journaled) — a member/partner/
// former company is left as-is.
export async function updateProposalStatus(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgContext();

  const proposalId = String(formData.get("proposalId") ?? "").trim();
  if (!proposalId) throw new Error("missing proposal");

  const status = String(formData.get("status") ?? "").trim();
  if (!isProposalStatus(status)) throw new Error("invalid proposal status");

  const companyId = await withOrg(orgId, async (tx) => {
    const proposal = await tx.membershipProposal.findUnique({
      where: { id: proposalId },
      select: { companyId: true },
    });
    if (proposal == null) return null;

    await tx.membershipProposal.update({
      where: { id: proposalId },
      data: { status, lastFollowUpAt: new Date() },
    });

    // Winning nudges a prospect into membership, journaled like the lifecycle
    // shortcut so the relationship timeline reflects the close.
    if (status === "won") {
      const company = await tx.company.findUnique({
        where: { id: proposal.companyId },
        select: { status: true },
      });
      if (company != null && company.status === "prospect") {
        await tx.company.update({
          where: { id: proposal.companyId },
          data: { status: "member" },
        });
        await tx.activity.create({
          data: {
            orgId,
            companyId: proposal.companyId,
            actorUserId: userId,
            type: ACTIVITY_STATUS_CHANGED,
            payload: { from: "prospect", to: "member" },
            occurredAt: new Date(),
          },
        });
      }
    }
    return proposal.companyId;
  });

  if (companyId == null)
    throw new Error("proposal not found in this organization");
  revalidateProposal(companyId);
}

export async function deleteProposal(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const proposalId = String(formData.get("proposalId") ?? "").trim();
  if (!proposalId) throw new Error("missing proposal");

  const companyId = await withOrg(orgId, async (tx) => {
    const proposal = await tx.membershipProposal.findUnique({
      where: { id: proposalId },
      select: { companyId: true },
    });
    if (proposal == null) return null;
    await tx.membershipProposal.delete({ where: { id: proposalId } });
    return proposal.companyId;
  });

  if (companyId == null)
    throw new Error("proposal not found in this organization");
  revalidateProposal(companyId);
}

// ── P4: per-company Value Delivered ledger ──────────────────────────────────
// The profile's Value Delivered card records concrete wins the network delivered
// to a member — an intro that bore fruit, a grant, a service — with the outcome
// and derived dollar value. Each write re-loads the parent company (and, when
// linked, the introduction) inside withOrg — a foreign id resolves null under RLS
// and the write is refused. Feeds the per-member drill-down of value created; the
// org-wide rollup lives on the Value Created page (revalidated alongside).

function revalidateValue(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/value-created");
  revalidatePath("/dashboard");
}

export async function logValueDelivered(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const kind = String(formData.get("kind") ?? "other").trim() || "other";
  if (!isValueKind(kind)) throw new Error("invalid value kind");

  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) throw new Error("summary is required");

  const amount = optionalAmount(formData, "amount");
  const outcome = String(formData.get("outcome") ?? "").trim();
  // Default to today when no date is given — a logged win happened now.
  const occurredAt = optionalDate(formData, "occurredAt") ?? new Date();
  const introductionId = optionalText(formData, "introductionId");

  const ok = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (company == null) return false;

    // A linked intro must be visible in this tenant (RLS) — a foreign id is
    // refused rather than silently stored as a dangling reference.
    if (introductionId !== null) {
      const intro = await tx.introduction.findUnique({
        where: { id: introductionId },
        select: { id: true },
      });
      if (intro == null) return false;
    }

    await tx.valueDelivered.create({
      data: {
        orgId,
        companyId,
        kind,
        introductionId,
        amount,
        summary,
        outcome,
        occurredAt,
      },
    });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");
  revalidateValue(companyId);
}

export async function deleteValueDelivered(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const valueId = String(formData.get("valueId") ?? "").trim();
  if (!valueId) throw new Error("missing value entry");

  const companyId = await withOrg(orgId, async (tx) => {
    const entry = await tx.valueDelivered.findUnique({
      where: { id: valueId },
      select: { companyId: true },
    });
    if (entry == null) return null;
    await tx.valueDelivered.delete({ where: { id: valueId } });
    return entry.companyId;
  });

  if (companyId == null)
    throw new Error("value entry not found in this organization");
  revalidateValue(companyId);
}

// ── P5: additional companies / affiliations ─────────────────────────────────
// The other hats a member wears — a separate business line with its own offer/
// need profile. Flat text sub-records of the member. Each write re-loads the
// parent company (create) or the affiliation itself (update/delete) inside
// withOrg — a foreign id resolves null under RLS and the write is refused.

function revalidateAffiliation(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard");
}

// The flat text fields the affiliation editor writes (all optional, default "").
function readAffiliationFields(formData: FormData) {
  const str = (key: string) => String(formData.get(key) ?? "").trim();
  return {
    role: str("role"),
    industry: str("industry"),
    website: str("website"),
    canOffer: str("canOffer"),
    lookingFor: str("lookingFor"),
    counties: str("counties"),
    dealSize: str("dealSize"),
  };
}

export async function addAffiliation(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("affiliated company is required");

  const ok = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (company == null) return false;

    await tx.affiliation.create({
      data: { orgId, companyId, name, ...readAffiliationFields(formData) },
    });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");
  revalidateAffiliation(companyId);
}

export async function updateAffiliation(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const affiliationId = String(formData.get("affiliationId") ?? "").trim();
  if (!affiliationId) throw new Error("missing affiliation");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("affiliated company is required");

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.affiliation.findUnique({
      where: { id: affiliationId },
      select: { companyId: true },
    });
    if (existing == null) return null;

    await tx.affiliation.update({
      where: { id: affiliationId },
      data: { name, ...readAffiliationFields(formData) },
    });
    return existing.companyId;
  });

  if (companyId == null)
    throw new Error("affiliation not found in this organization");
  revalidateAffiliation(companyId);
}

export async function deleteAffiliation(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const affiliationId = String(formData.get("affiliationId") ?? "").trim();
  if (!affiliationId) throw new Error("missing affiliation");

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.affiliation.findUnique({
      where: { id: affiliationId },
      select: { companyId: true },
    });
    if (existing == null) return null;
    await tx.affiliation.delete({ where: { id: affiliationId } });
    return existing.companyId;
  });

  if (companyId == null)
    throw new Error("affiliation not found in this organization");
  revalidateAffiliation(companyId);
}

// ── P6a: partnership section (strategic_partner companies only) ─────────────
// A strategic partner's profile carries a small partnership block: category,
// relationship/role, a who-they-are/why-strategic summary, and what we're
// collaborating on. `updatePartnership` saves the form; `synthesizePartner`
// runs the web-research AI to draft the summary/category/collaboration (the
// operator then reviews and saves via the same form). Both re-verify the
// company inside withOrg so a foreign id is refused by RLS.

// Save the partnership fields. Guarded to strategic_partner companies — the card
// only renders for them, and re-checking here keeps the block from leaking onto
// a non-partner via a hand-forged post.
export async function updatePartnership(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const str = (key: string, max: number) =>
    String(formData.get(key) ?? "").trim().slice(0, max);
  const data = {
    website: optionalText(formData, "website"),
    partnerCategory: str("partnerCategory", 60),
    partnerRelationship: str("partnerRelationship", 2000),
    partnerSummary: str("partnerSummary", 2000),
    collaborationNotes: str("collaborationNotes", 2000),
  };

  const ok = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (company == null) return false;
    if (company.status !== "strategic_partner")
      throw new Error("partnership details apply only to strategic partners");
    await tx.company.update({ where: { id: companyId }, data });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard");
}

export type PartnerSynthState =
  | { status: "idle" }
  | { status: "ok"; synthesis: PartnerSynthesis }
  | { status: "error"; message: string };

// Research the partner and return a draft brief for the operator to review. Like
// the other useActionState AI seams it returns state rather than throwing, so a
// model/network failure renders inline. Nothing is persisted here.
export async function synthesizePartner(
  _prev: PartnerSynthState,
  formData: FormData,
): Promise<PartnerSynthState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId, orgName } = await requireOrgContext();

  const company = await withOrg(orgId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        status: true,
        website: true,
        partnerRelationship: true,
        industry: true,
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: { name: true },
        },
      },
    }),
  );

  if (company == null)
    return { status: "error", message: "company not found in this organization" };
  if (company.status !== "strategic_partner")
    return {
      status: "error",
      message: "partnership synthesis applies only to strategic partners",
    };

  // The form may hand over freshly-typed website/relationship values the operator
  // hasn't saved yet; fall back to what's on the row (relationship falls back to
  // the industry, mirroring the prototype).
  const website = String(formData.get("website") ?? "").trim() || (company.website ?? "");
  const relationship =
    String(formData.get("partnerRelationship") ?? "").trim() ||
    company.partnerRelationship ||
    company.industry;
  if (!website && !relationship)
    return {
      status: "error",
      message: "Add a website or relationship note first, then synthesize.",
    };

  try {
    await enforceAiRateLimit(orgId);
    const synthesis = await generatePartnerSynthesis({
      orgName,
      companyName: company.name,
      contactName: company.contacts[0]?.name ?? "",
      relationship,
      website,
    });
    if (synthesis == null)
      return { status: "error", message: "Could not synthesize a brief. Try again." };
    return { status: "ok", synthesis };
  } catch (err) {
    console.error("partner synthesis failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not synthesize a brief. Try again." };
  }
}

// ── P6b: Their Network — key relationships (strategic_partner companies only) ─
// The key external contacts a partner can connect the network with. Flat text
// sub-records of the owning partner, each optionally linked to a CRM company (or
// promoted into one as a fresh prospect). Every write re-loads the parent partner
// (create) or the relationship itself (update/delete/link) inside withOrg — a
// foreign id resolves null under RLS and the write is refused.

function revalidateKeyRel(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard");
}

// The flat text fields the Their-Network editor writes (all optional, default "").
function readKeyRelFields(formData: FormData) {
  const str = (key: string) => String(formData.get(key) ?? "").trim().slice(0, 500);
  return {
    title: str("title"),
    org: str("org"),
    relevance: str("relevance"),
    email: str("email"),
    phone: str("phone"),
  };
}

export async function addKeyRelationship(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!name) throw new Error("contact name is required");

  const ok = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (company == null) return false;
    if (company.status !== "strategic_partner")
      throw new Error("key relationships apply only to strategic partners");
    await tx.keyRelationship.create({
      data: { orgId, companyId, name, ...readKeyRelFields(formData) },
    });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");
  revalidateKeyRel(companyId);
}

export async function updateKeyRelationship(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const relationshipId = String(formData.get("relationshipId") ?? "").trim();
  if (!relationshipId) throw new Error("missing relationship");

  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!name) throw new Error("contact name is required");

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.keyRelationship.findUnique({
      where: { id: relationshipId },
      select: { companyId: true },
    });
    if (existing == null) return null;
    await tx.keyRelationship.update({
      where: { id: relationshipId },
      data: { name, ...readKeyRelFields(formData) },
    });
    return existing.companyId;
  });

  if (companyId == null)
    throw new Error("relationship not found in this organization");
  revalidateKeyRel(companyId);
}

export async function deleteKeyRelationship(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const relationshipId = String(formData.get("relationshipId") ?? "").trim();
  if (!relationshipId) throw new Error("missing relationship");

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.keyRelationship.findUnique({
      where: { id: relationshipId },
      select: { companyId: true },
    });
    if (existing == null) return null;
    await tx.keyRelationship.delete({ where: { id: relationshipId } });
    return existing.companyId;
  });

  if (companyId == null)
    throw new Error("relationship not found in this organization");
  revalidateKeyRel(companyId);
}

// Link a relationship to an existing CRM company. Both the relationship and the
// target company are re-verified inside withOrg, so a foreign id on either side
// resolves null under RLS and the link is refused (same-org enforced). A blank
// linkedCompanyId clears the link.
export async function linkKeyRelationship(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const relationshipId = String(formData.get("relationshipId") ?? "").trim();
  if (!relationshipId) throw new Error("missing relationship");

  const linkedCompanyId = String(formData.get("linkedCompanyId") ?? "").trim();

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.keyRelationship.findUnique({
      where: { id: relationshipId },
      select: { companyId: true },
    });
    if (existing == null) return null;

    if (linkedCompanyId !== "") {
      const target = await tx.company.findUnique({
        where: { id: linkedCompanyId },
        select: { id: true },
      });
      if (target == null)
        throw new Error("linked company not found in this organization");
    }

    await tx.keyRelationship.update({
      where: { id: relationshipId },
      data: { linkedCompanyId: linkedCompanyId === "" ? null : linkedCompanyId },
    });
    return existing.companyId;
  });

  if (companyId == null)
    throw new Error("relationship not found in this organization");
  revalidateKeyRel(companyId);
}

// Promote a relationship into the CRM as a fresh prospect company (+ primary
// contact), then link it back. Mirrors the prototype's "+ Add to CRM". The new
// company's name is the contact's org (falling back to their own name); the
// person becomes the primary contact. All inside one withOrg tx.
export async function addRelationshipAsProspect(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const relationshipId = String(formData.get("relationshipId") ?? "").trim();
  if (!relationshipId) throw new Error("missing relationship");

  const companyId = await withOrg(orgId, async (tx) => {
    const rel = await tx.keyRelationship.findUnique({
      where: { id: relationshipId },
      select: {
        companyId: true,
        name: true,
        title: true,
        org: true,
        email: true,
        phone: true,
        relevance: true,
        linkedCompanyId: true,
      },
    });
    if (rel == null) return null;
    if (!rel.name.trim())
      throw new Error("add a contact name before adding to the CRM");
    if (rel.linkedCompanyId != null)
      throw new Error("this relationship is already linked to a company");

    const partner = await tx.company.findUnique({
      where: { id: rel.companyId },
      select: { name: true },
    });
    const note =
      `From partner network: ${partner?.name ?? ""}`.trim() +
      (rel.relevance ? ` — ${rel.relevance}` : "");

    const prospect = await tx.company.create({
      data: {
        orgId,
        name: rel.org.trim() || rel.name.trim(),
        status: "prospect",
        industry: "",
        annualValue: "0",
        notes: note,
        contacts: {
          create: {
            orgId,
            name: rel.name.trim(),
            title: rel.title || null,
            email: rel.email || null,
            phone: rel.phone || null,
            isPrimary: true,
          },
        },
      },
      select: { id: true },
    });

    await tx.keyRelationship.update({
      where: { id: relationshipId },
      data: { linkedCompanyId: prospect.id },
    });
    return rel.companyId;
  });

  if (companyId == null)
    throw new Error("relationship not found in this organization");
  revalidateKeyRel(companyId);
  revalidatePath("/dashboard/companies");
}

// Lifecycle shortcut — the Convert / Archive / Restore buttons. A no-op status
// (already there) still returns ok so the button is idempotent; only a real
// transition writes the Activity.
export async function changeCompanyStatus(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const status = String(formData.get("status") ?? "").trim();
  if (!isCompanyStatus(status)) throw new Error("invalid company status");

  const ok = await withOrg(orgId, async (tx) => {
    const current = await tx.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (current == null) return false;
    if (current.status === status) return true;

    await tx.company.update({ where: { id: companyId }, data: { status } });
    await tx.activity.create({
      data: {
        orgId,
        companyId,
        actorUserId: userId,
        type: ACTIVITY_STATUS_CHANGED,
        payload: { from: current.status, to: status },
        occurredAt: new Date(),
      },
    });
    return true;
  });

  if (!ok) throw new Error("company not found in this organization");

  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}
