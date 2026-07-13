import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P5 affiliations slice
// (addAffiliation + updateAffiliation + deleteAffiliation). Runs against the
// real Neon DB, mocking only Clerk (requireOrgContext) and Next's
// revalidatePath. Proves the flat-field write under a member company, an update
// and a scoped delete, and that a foreign company id (create) or a foreign
// affiliation id (update/delete) is refused by RLS with the other tenant left
// untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { addAffiliation, updateAffiliation, deleteAffiliation } = await import(
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
// A seeded orgB affiliation — the foreign target for the update/delete refusal.
const affiliationBId = randomUUID();

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
    await tx.affiliation.create({
      data: {
        id: affiliationBId,
        orgId: orgB.id,
        companyId: companyBId,
        name: "Beta's other venture",
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

describe("addAffiliation", () => {
  test("stores an affiliation under its company with all flat fields", async () => {
    await addAffiliation(
      fd({
        companyId: companyAId,
        name: "Acme Logistics",
        role: "Founder",
        industry: "Transportation",
        website: "acmelogistics.com",
        canOffer: "Fleet capacity",
        lookingFor: "Warehouse partners",
        counties: "Dutchess, Ulster",
        dealSize: "$50k-$200k",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findFirst({
        where: { companyId: companyAId, name: "Acme Logistics" },
        select: {
          role: true,
          industry: true,
          website: true,
          canOffer: true,
          lookingFor: true,
          counties: true,
          dealSize: true,
        },
      }),
    );
    expect(row).toMatchObject({
      role: "Founder",
      industry: "Transportation",
      website: "acmelogistics.com",
      canOffer: "Fleet capacity",
      lookingFor: "Warehouse partners",
      counties: "Dutchess, Ulster",
      dealSize: "$50k-$200k",
    });
  });

  test("requires an affiliated company name", async () => {
    await expect(
      addAffiliation(fd({ companyId: companyAId, name: "  " })),
    ).rejects.toThrow("affiliated company is required");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      addAffiliation(fd({ companyId: companyBId, name: "hijack" })),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.affiliation.count({ where: { companyId: companyBId } }),
    );
    // Only the seeded Beta affiliation remains — no foreign write landed.
    expect(count).toBe(1);
  });
});

describe("updateAffiliation", () => {
  test("updates an affiliation scoped to the tenant", async () => {
    const affiliationId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.affiliation.create({
        data: {
          id: affiliationId,
          orgId: orgA.id,
          companyId: companyAId,
          name: "Acme Ventures",
          role: "Advisor",
        },
      }),
    );

    await updateAffiliation(
      fd({ affiliationId, name: "Acme Ventures", role: "Managing Partner" }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findUnique({
        where: { id: affiliationId },
        select: { role: true },
      }),
    );
    expect(row!.role).toBe("Managing Partner");
  });

  test("refuses an affiliation id from another tenant and leaves it untouched", async () => {
    await expect(
      updateAffiliation(fd({ affiliationId: affiliationBId, name: "hijacked" })),
    ).rejects.toThrow("affiliation not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.affiliation.findUnique({
        where: { id: affiliationBId },
        select: { name: true },
      }),
    );
    expect(still!.name).toBe("Beta's other venture");
  });
});

describe("deleteAffiliation", () => {
  test("deletes an affiliation scoped to the tenant", async () => {
    const affiliationId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.affiliation.create({
        data: {
          id: affiliationId,
          orgId: orgA.id,
          companyId: companyAId,
          name: "Acme Disposable",
        },
      }),
    );

    await deleteAffiliation(fd({ affiliationId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findUnique({ where: { id: affiliationId } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses an affiliation id from another tenant and leaves it untouched", async () => {
    await expect(
      deleteAffiliation(fd({ affiliationId: affiliationBId })),
    ).rejects.toThrow("affiliation not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.affiliation.findUnique({ where: { id: affiliationBId } }),
    );
    expect(still).not.toBeNull();
  });
});
