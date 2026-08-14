import "server-only";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { OwnerCandidate } from "@/lib/action-items";

// The owner-candidate loaders for action-item extraction — the two pools the
// model attributes an item to. Shared by the manual meetings-surface extraction
// (meetings/actions.ts) and the automatic on-sync extraction (auto-action-items.ts)
// so both feed generateActionItems the SAME, RLS-scoped candidate set.

// Org staff who can own a "we owe" item — the org's members. org_memberships is
// a platform table (no RLS), so it is read off the bare prisma client, exactly
// as @/lib/auth does.
export async function loadStaffOwners(orgId: string): Promise<OwnerCandidate[]> {
  const rows = await prisma.orgMembership.findMany({
    where: { orgId },
    select: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.user.id, name: r.user.name }));
}

// This meeting's matched attendee contacts — the "they owe" owner candidates.
export async function loadAttendeeOwners(
  orgId: string,
  meetingId: string,
): Promise<OwnerCandidate[]> {
  const rows = await withOrg(orgId, (tx) =>
    tx.meetingAttendee.findMany({
      where: { meetingId },
      select: { contactId: true, contact: { select: { name: true } } },
    }),
  );
  return rows.map((r) => ({ id: r.contactId, name: r.contact.name }));
}
