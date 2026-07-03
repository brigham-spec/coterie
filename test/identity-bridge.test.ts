import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// The identity bridge (build item 4): organizations.clerk_id maps a signed-in
// Clerk org (org_…) to our tenant uuid. requireOrgContext resolves it via this
// lookup; these tests exercise the Clerk-free DB half (no session mocking) so
// the bridge column, its uniqueness, and org->tenant scoping are all guarded.
const clerkOrgId = `org_test_${randomUUID().replace(/-/g, "")}`;
const org = { id: randomUUID(), name: `BRIDGE_${randomUUID()}` };
let companyId: string;

beforeAll(async () => {
  await prisma.organization.create({
    data: { ...org, clerkId: clerkOrgId, orgType: "edc" },
  });
  companyId = (
    await withOrg(org.id, (tx) =>
      tx.company.create({
        data: {
          orgId: org.id,
          name: "Bridge Co",
          status: "member",
          industry: "test",
          annualValue: 1000,
        },
      }),
    )
  ).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("identity bridge (organizations.clerk_id)", () => {
  test("a Clerk org id resolves to exactly one tenant uuid", async () => {
    const resolved = await prisma.organization.findUnique({
      where: { clerkId: clerkOrgId },
    });
    expect(resolved?.id).toBe(org.id);
  });

  test("clerk_id is unique — a Clerk org cannot map to two tenants", async () => {
    await expect(
      prisma.organization.create({
        data: { name: "dupe", clerkId: clerkOrgId, orgType: "edc" },
      }),
    ).rejects.toThrow();
  });

  test("the resolved uuid scopes tenant reads through withOrg", async () => {
    const resolved = await prisma.organization.findUnique({
      where: { clerkId: clerkOrgId },
    });
    const rows = await withOrg(resolved!.id, (tx) => tx.company.findMany());
    expect(rows.map((c) => c.id)).toContain(companyId);
  });
});
