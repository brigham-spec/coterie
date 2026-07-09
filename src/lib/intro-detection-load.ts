import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  detectPendingIntroAdvances,
  isDetectableStage,
  type DetectableIntro,
  type DetectionMeeting,
  type PendingIntroDetection,
} from "./intro-detection";

// Assembles the inputs the pure detector (@/lib/intro-detection) needs from the
// tenant's data and runs it. Given a withOrg-scoped transaction client, RLS keeps
// every read inside the caller's org, so detections can never span tenants. The
// caller owns the transaction (both the dashboard and a company profile fold this
// into their existing single withOrg pass); this never opens one itself.
//
// Pass `companyId` to scope to one company's profile: only introductions with a
// party at that company are considered.

export async function loadPendingIntroDetections(
  tx: Prisma.TransactionClient,
  companyId?: string,
): Promise<PendingIntroDetection[]> {
  const introRows = await tx.introduction.findMany({
    where: companyId
      ? {
          OR: [
            { partyA: { companyId } },
            { partyB: { companyId } },
          ],
        }
      : undefined,
    select: {
      id: true,
      status: true,
      madeOn: true,
      createdAt: true,
      partyA: {
        select: { company: { select: { id: true, name: true } } },
      },
      partyB: {
        select: { company: { select: { id: true, name: true } } },
      },
    },
  });

  const intros: DetectableIntro[] = introRows
    .filter((i) => isDetectableStage(i.status))
    .map((i) => ({
      id: i.id,
      status: i.status,
      // Fall back to the creation instant when no made date was recorded, so a
      // just-logged intro still has a reference point for later meetings.
      since: i.madeOn ?? i.createdAt,
      partyACompanyId: i.partyA.company.id,
      partyBCompanyId: i.partyB.company.id,
      partyALabel: i.partyA.company.name,
      partyBLabel: i.partyB.company.name,
    }));

  // No detectable intros → no need to scan meetings at all.
  if (intros.length === 0) return [];

  const meetingRows = await tx.meeting.findMany({
    select: {
      id: true,
      title: true,
      heldAt: true,
      attendees: { select: { contact: { select: { companyId: true } } } },
    },
  });

  const meetings: DetectionMeeting[] = meetingRows.map((m) => ({
    id: m.id,
    title: m.title,
    heldAt: m.heldAt,
    companyIds: new Set(m.attendees.map((a) => a.contact.companyId)),
  }));

  return detectPendingIntroAdvances(intros, meetings);
}
