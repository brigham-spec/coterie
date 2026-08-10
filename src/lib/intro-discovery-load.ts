import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  detectNewIntroCandidates,
  DISCOVERY_WINDOW_DAYS,
  type DiscoveryMeeting,
  type KnownPair,
  type NewIntroCandidate,
} from "./intro-discovery";

// Assembles the inputs the pure discoverer (@/lib/intro-discovery) needs from the
// tenant's data and runs it. Given a withOrg-scoped transaction client, RLS keeps
// every read inside the caller's org, so candidates can never span tenants. The
// caller owns the transaction (the introductions page folds this into its single
// withOrg pass); this never opens one itself.
//
// Only meetings held within the discovery window are scanned, so the list stays a
// live worklist of recent opportunities rather than the whole history.

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadNewIntroCandidates(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<NewIntroCandidate[]> {
  const cutoff = new Date(now.getTime() - DISCOVERY_WINDOW_DAYS * DAY_MS);

  const meetingRows = await tx.meeting.findMany({
    where: { heldAt: { gte: cutoff } },
    orderBy: { heldAt: "desc" },
    select: {
      id: true,
      title: true,
      heldAt: true,
      attendees: {
        select: {
          contact: {
            select: {
              id: true,
              name: true,
              companyId: true,
              company: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // No recent meetings → no opportunities, and no need to scan the ledger.
  if (meetingRows.length === 0) return [];

  const meetings: DiscoveryMeeting[] = meetingRows.map((m) => ({
    id: m.id,
    title: m.title,
    heldAt: m.heldAt,
    attendees: m.attendees.map((a) => ({
      contactId: a.contact.id,
      contactName: a.contact.name,
      companyId: a.contact.companyId,
      companyName: a.contact.company.name,
    })),
  }));

  // Any logged introduction between two companies means they're already
  // introduced, so the pair is suppressed regardless of the intro's stage.
  const introRows = await tx.introduction.findMany({
    select: {
      partyA: { select: { companyId: true } },
      partyB: { select: { companyId: true } },
    },
  });
  const existingPairs: KnownPair[] = introRows.map((i) => ({
    aCompanyId: i.partyA.companyId,
    bCompanyId: i.partyB.companyId,
  }));

  return detectNewIntroCandidates(meetings, existingPairs);
}
