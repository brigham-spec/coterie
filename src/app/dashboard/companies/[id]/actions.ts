"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { isIntroStage } from "@/lib/intro-stages";
import { getStageDef, TERMINAL_STAGES } from "@/lib/project-stages";
import { NETWORK_STATUSES } from "@/lib/company-statuses";
import { generateCompanyBrief } from "@/lib/anthropic";
import { generateMeetingPrep, type PrepCommitment } from "@/lib/meeting-prep";
import {
  generateWhyJoinPitch,
  type PitchMember,
  type WhyJoinPitch,
} from "@/lib/why-join";
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
