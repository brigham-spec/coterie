import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P4 value-delivered slice
// (logValueDelivered + deleteValueDelivered). Runs against the real Neon DB,
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// field write with kind validation, that a linked introduction is stored, that a
// foreign company id or a foreign introduction id (create) or value id (delete)
// is refused by RLS and leaves the other tenant untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { logValueDelivered, deleteValueDelivered } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

const companyAId = randomUUID();
const companyBId = randomUUID();
// Contacts anchor the introductions (two parties each).
const contactA1 = randomUUID();
const contactA2 = randomUUID();
const contactB1 = randomUUID();
const contactB2 = randomUUID();
const introAId = randomUUID();
const introBId = randomUUID();
// A seeded orgB value entry — the foreign target for the delete-refusal test.
const valueBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: staffUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "staff" },
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
    await tx.contact.createMany({
      data: [
        { id: contactA1, orgId: orgA.id, companyId: companyAId, name: "Ada A" },
        { id: contactA2, orgId: orgA.id, companyId: companyAId, name: "Ben A" },
      ],
    });
    await tx.introduction.create({
      data: {
        id: introAId,
        orgId: orgA.id,
        partyAContactId: contactA1,
        partyBContactId: contactA2,
        status: "made",
        source: "manual",
      },
    });
  });

  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Beta Corp",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
      },
    });
    await tx.contact.createMany({
      data: [
        { id: contactB1, orgId: orgB.id, companyId: companyBId, name: "Cal B" },
        { id: contactB2, orgId: orgB.id, companyId: companyBId, name: "Dot B" },
      ],
    });
    await tx.introduction.create({
      data: {
        id: introBId,
        orgId: orgB.id,
        partyAContactId: contactB1,
        partyBContactId: contactB2,
        status: "made",
        source: "manual",
      },
    });
    await tx.valueDelivered.create({
      data: {
        id: valueBId,
        orgId: orgB.id,
        companyId: companyBId,
        kind: "grant",
        summary: "Beta's own win",
        occurredAt: new Date("2026-01-01"),
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("logValueDelivered", () => {
  test("logs a value entry under its company with the given fields", async () => {
    await logValueDelivered(
      fd({
        companyId: companyAId,
        kind: "grant",
        amount: "40000",
        summary: "Secured a state manufacturing grant.",
        outcome: "Funds released Q3.",
        occurredAt: "2026-06-01",
      }),
    );

    const entry = await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.findFirst({
        where: { companyId: companyAId, kind: "grant" },
        select: {
          kind: true,
          amount: true,
          summary: true,
          outcome: true,
          occurredAt: true,
          introductionId: true,
        },
      }),
    );
    expect(entry!.kind).toBe("grant");
    expect(Number(entry!.amount)).toBe(40000);
    expect(entry!.summary).toBe("Secured a state manufacturing grant.");
    expect(entry!.outcome).toBe("Funds released Q3.");
    expect(entry!.occurredAt?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(entry!.introductionId).toBeNull();
  });

  test("stores a linked introduction from the same tenant", async () => {
    await logValueDelivered(
      fd({
        companyId: companyAId,
        kind: "introduction",
        summary: "Warm intro that led to a supply deal.",
        introductionId: introAId,
      }),
    );

    const entry = await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.findFirst({
        where: { companyId: companyAId, kind: "introduction" },
        select: { introductionId: true, amount: true },
      }),
    );
    expect(entry!.introductionId).toBe(introAId);
    // Non-monetary win — no amount attached.
    expect(entry!.amount).toBeNull();
  });

  test("rejects an unknown kind", async () => {
    await expect(
      logValueDelivered(fd({ companyId: companyAId, kind: "meeting", summary: "x" })),
    ).rejects.toThrow("invalid value kind");
  });

  test("requires a summary", async () => {
    await expect(
      logValueDelivered(fd({ companyId: companyAId, kind: "other", summary: "  " })),
    ).rejects.toThrow("summary is required");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      logValueDelivered(fd({ companyId: companyBId, kind: "other", summary: "hijack" })),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.valueDelivered.count({ where: { companyId: companyBId } }),
    );
    // Only the seeded Beta entry remains — no foreign write landed.
    expect(count).toBe(1);
  });

  test("refuses a foreign introduction id even for a valid company", async () => {
    await expect(
      logValueDelivered(
        fd({
          companyId: companyAId,
          kind: "introduction",
          summary: "cross-tenant intro link",
          introductionId: introBId,
        }),
      ),
    ).rejects.toThrow("company not found in this organization");

    const linked = await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.count({
        where: { companyId: companyAId, introductionId: introBId },
      }),
    );
    expect(linked).toBe(0);
  });
});

describe("deleteValueDelivered", () => {
  test("deletes a value entry scoped to the tenant", async () => {
    const valueId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.create({
        data: {
          id: valueId,
          orgId: orgA.id,
          companyId: companyAId,
          kind: "service",
          summary: "Advisory hours.",
          occurredAt: new Date("2026-02-01"),
        },
      }),
    );

    await deleteValueDelivered(fd({ valueId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.findUnique({ where: { id: valueId } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses a value id from another tenant and leaves it untouched", async () => {
    await expect(
      deleteValueDelivered(fd({ valueId: valueBId })),
    ).rejects.toThrow("value entry not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.valueDelivered.findUnique({ where: { id: valueBId } }),
    );
    expect(still).not.toBeNull();
  });
});
