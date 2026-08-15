import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { NETWORK_STATUSES } from "@/lib/company-statuses";
import { RSVP_CONFIRMED, RSVP_ATTENDED } from "@/lib/event-stages";
import { eligibleCandidateIds } from "@/lib/intro-engine";
import { deriveValueEntries, type ValueDeliveredEntry } from "@/lib/value-delivered";
import {
  MAX_CANDIDATES,
  type MeetingPrepInput,
  type PrepCandidate,
  type PrepCommitment,
  type PrepValueSnapshot,
} from "@/lib/meeting-prep";

// Shared loader + shaping for the pre-meeting brief. Both the on-screen "Meeting
// prep" card (generateMeetingPrepAction) and the printable brief route load the
// same relationship snapshot, so the read + the derived-value/candidate/commitment
// shaping live here once. Given a withOrg-scoped transaction client, RLS keeps
// every read inside the caller's org; the caller owns the transaction (this never
// opens one), matching the other @/lib/*-load modules.

// Cap the news headlines folded into the brief so a heavily-covered company still
// yields a bounded prompt; freshest first, so the most relevant coverage survives.
export const PREP_NEWS_LIMIT = 5;

/// Load the relationship snapshot the brief is built from — the company, the
/// meetings its people attended (freshest first) and the open commitments on
/// them, recent coverage, the full value-delivered ledger (with each linked
/// introduction's party names), the introductions it's a party to, its confirmed/
/// attended events, and a bounded candidate pool for grounded intro recs. Returns
/// null when the company isn't in this tenant. Sequential reads only — one pooled
/// connection per withOrg tx.
export async function loadMeetingBriefData(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
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
        select: { text: true, ownerUserId: true },
      })
    : [];

  const newsItems = await tx.newsItem.findMany({
    where: { companyId },
    orderBy: { capturedAt: "desc" },
    take: PREP_NEWS_LIMIT,
    select: { headline: true, url: true, capturedAt: true },
  });

  // Full value rows (with each linked introduction's party names) so the printable
  // brief can render every win and trace it back to the introduction it came from;
  // the on-screen card only needs the totals, which this superset also serves.
  const valueDelivered = await tx.valueDelivered.findMany({
    where: { companyId },
    orderBy: { occurredAt: "desc" },
    select: {
      id: true,
      kind: true,
      amount: true,
      summary: true,
      outcome: true,
      occurredAt: true,
      introductionId: true,
      introduction: {
        select: {
          partyA: { select: { name: true } },
          partyB: { select: { name: true } },
        },
      },
    },
  });

  const introductions = await tx.introduction.findMany({
    where: { OR: [{ partyA: { companyId } }, { partyB: { companyId } }] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      headline: true,
      outcome: true,
      madeOn: true,
      createdAt: true,
      partyA: {
        select: { name: true, company: { select: { id: true, name: true } } },
      },
      partyB: {
        select: { name: true, company: { select: { id: true, name: true } } },
      },
    },
  });

  const eventInvites = contactIds.length
    ? await tx.eventInvitee.findMany({
        where: {
          contactId: { in: contactIds },
          rsvp: { in: [RSVP_CONFIRMED, RSVP_ATTENDED] },
        },
        select: {
          id: true,
          rsvp: true,
          event: { select: { name: true, date: true, createdAt: true } },
        },
      })
    : [];

  // Companies already introduced to the focus (either direction) — excluded from
  // the candidate pool below.
  const excluded = new Set<string>();
  for (const i of introductions) {
    if (i.partyA.company?.id) excluded.add(i.partyA.company.id);
    if (i.partyB.company?.id) excluded.add(i.partyB.company.id);
  }

  // Candidate pool for grounded intro recommendations: the tenant's network
  // companies, minus the focus and anyone it's already been introduced to. Bound
  // the fetch — the prompt reads only the first MAX_CANDIDATES — with a margin for
  // the focus + excluded rows that get filtered out.
  const poolCompanies = await tx.company.findMany({
    where: { status: { in: [...NETWORK_STATUSES] } },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES + excluded.size + 1,
    select: {
      id: true,
      name: true,
      industry: true,
      lookingFor: true,
      canOffer: true,
    },
  });

  return {
    company,
    recentMeetings,
    openCommitments,
    newsItems,
    valueDelivered,
    introductions,
    eventInvites,
    poolCompanies,
    excluded,
  };
}

export type MeetingBriefData = NonNullable<
  Awaited<ReturnType<typeof loadMeetingBriefData>>
>;

/// Open commitments as the brief's "what was committed" thread. The owner-XOR
/// CHECK guarantees exactly one owner is set, so a null ownerUserId means the
/// contact owns it ("they owe").
export function briefCommitments(data: MeetingBriefData): PrepCommitment[] {
  return data.openCommitments.map((c) => ({
    text: c.text,
    owedBy: c.ownerUserId != null ? "us" : "them",
  }));
}

/// The company's manual value ledger folded together with derived network value
/// (realized intros, attended events, project collaborations) — the same entry set
/// the profile's Value Delivered card and the value report build. Manual rows carry
/// their linked introduction's label so downstream wins can be traced back to it.
export function briefValueEntries(
  data: MeetingBriefData,
  companyId: string,
): ValueDeliveredEntry[] {
  const manualEntries: ValueDeliveredEntry[] = data.valueDelivered.map((v) => ({
    id: v.id,
    kind: v.kind,
    amount: v.amount == null ? null : Number(v.amount),
    summary: v.summary,
    outcome: v.outcome,
    occurredAt: v.occurredAt,
    introLabel: v.introduction
      ? `${v.introduction.partyA.name} \u2194 ${v.introduction.partyB.name}`
      : null,
  }));

  const derivedEntries = deriveValueEntries({
    intros: data.introductions.map((i) => {
      const other = i.partyA.company?.id === companyId ? i.partyB : i.partyA;
      return {
        introId: i.id,
        status: i.status,
        headline: i.headline,
        outcome: i.outcome,
        madeOn: i.madeOn,
        createdAt: i.createdAt,
        partyAName: i.partyA.name,
        partyBName: i.partyB.name,
        counterpartCompany:
          other.company?.id === companyId ? null : (other.company?.name ?? null),
      };
    }),
    events: data.eventInvites.map((iv) => ({
      inviteeId: iv.id,
      eventName: iv.event.name,
      rsvp: iv.rsvp,
      occurredAt: iv.event.date ?? iv.event.createdAt,
    })),
    collaborations: data.company.projectLinks.map((l) => ({
      projectId: l.projectId,
      projectName: l.project.name,
      role: l.role,
      occurredAt: l.createdAt,
    })),
    ledgerIntroIds: new Set(
      data.valueDelivered
        .map((v) => v.introductionId)
        .filter((x): x is string => x != null),
    ),
  });

  return [...manualEntries, ...derivedEntries];
}

/// The grounded candidate pool the model may recommend from: the fetched network
/// companies minus the focus and anyone already introduced.
export function briefCandidates(
  data: MeetingBriefData,
  companyId: string,
): PrepCandidate[] {
  const eligible = new Set(
    eligibleCandidateIds(
      companyId,
      data.poolCompanies.map((c) => c.id),
      data.excluded,
    ),
  );
  return data.poolCompanies
    .filter((c) => eligible.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      lookingFor: c.lookingFor,
      canOffer: c.canOffer,
    }));
}

/// Assemble the model input from the loaded snapshot + the already-shaped
/// commitments/snapshot/candidates. ISO date strings keep everything serializable.
export function buildMeetingPrepInput(
  data: MeetingBriefData,
  args: {
    userName: string;
    commitments: PrepCommitment[];
    valueSnapshot: PrepValueSnapshot;
    candidates: PrepCandidate[];
  },
): MeetingPrepInput {
  return {
    userName: args.userName,
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
    openCommitments: args.commitments,
    recentNews: data.newsItems.map((n) => ({
      headline: n.headline,
      capturedAt: n.capturedAt.toISOString().slice(0, 10),
    })),
    valueSnapshot: args.valueSnapshot,
    candidates: args.candidates,
  };
}
