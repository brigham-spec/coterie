import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

import type { ContactOption, StaffOption } from "./_log";

// Owner pickers for the "Log commitment" form (LogCommitment). Both the
// commitments workspace and the dashboard home feed the same picker contract, so
// the query shape and — crucially — the `${name} · ${company.name}` contact
// label live here once, in lockstep with LogCommitment.

// Contacts drive the "they owe" picker. Loaded inside the caller's withOrg tx so
// RLS scopes it to the tenant.
export const contactOptionsSelect = {
  id: true,
  name: true,
  company: { select: { name: true } },
} satisfies Prisma.ContactSelect;

export function toContactOptions(
  rows: Prisma.ContactGetPayload<{ select: typeof contactOptionsSelect }>[],
): ContactOption[] {
  return rows.map((c) => ({ id: c.id, label: `${c.name} · ${c.company.name}` }));
}

// Org staff = org members (platform table, no RLS — read off bare prisma).
// Returns a promise so callers can kick it off alongside their withOrg batch;
// ordered by name for the picker.
export function loadStaffOptions(orgId: string): Promise<StaffOption[]> {
  return prisma.orgMembership
    .findMany({
      where: { orgId },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    })
    .then((rows) => rows.map((r) => r.user));
}
