import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P6b Their-Network slice (add/update/
// delete/link/unlink key relationships + add-as-prospect). Runs against the real
// Neon DB, mocking only Clerk (requireOrgContext) and Next's revalidatePath.
// Proves the field write under a partner, the strategic_partner-only guard, the
// CRM link/unlink (same-org enforced), promoting a relationship into a fresh
// prospect + primary contact, and that a foreign company/relationship id is
// refused by RLS with the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const {
  addKeyRelationship,
  updateKeyRelationship,
  deleteKeyRelationship,
  linkKeyRelationship,
  addRelationshipAsProspect,
} = await import("@/app/dashboard/companies/[id]/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

// orgA: a partner, a plain member (link target), a former company (excluded).
const partnerAId = randomUUID();
const memberAId = randomUUID();
// orgB: its own partner + a seeded relationship (foreign targets).
const partnerBId = randomUUID();
const memberBId = randomUUID();
const relBId = randomUUID();

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
        id: partnerAId,
        orgId: orgA.id,
        name: "State Grant Office",
        status: "strategic_partner",
        industry: "Government",
        annualValue: 0,
      },
    });
    await tx.company.create({
      data: {
        id: memberAId,
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
        id: partnerBId,
        orgId: orgB.id,
        name: "Beta Agency",
        status: "strategic_partner",
        industry: "Government",
        annualValue: 0,
      },
    });
    await tx.company.create({
      data: {
        id: memberBId,
        orgId: orgB.id,
        name: "Beta Member",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
      },
    });
    await tx.keyRelationship.create({
      data: { id: relBId, orgId: orgB.id, companyId: partnerBId, name: "Beta's contact" },
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

// Add one relationship under partnerA and return its id.
async function seedRel(over: Record<string, string> = {}): Promise<string> {
  await addKeyRelationship(
    fd({ companyId: partnerAId, name: "Contact", ...over }),
  );
  const row = await withOrg(orgA.id, (tx) =>
    tx.keyRelationship.findFirst({
      where: { companyId: partnerAId, name: over.name ?? "Contact" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  );
  return row!.id;
}

describe("addKeyRelationship", () => {
  test("stores a relationship under a strategic partner with all fields", async () => {
    await addKeyRelationship(
      fd({
        companyId: partnerAId,
        name: "Jane Roe",
        title: "Director",
        org: "State Housing",
        relevance: "Controls housing grants",
        email: "jane@housing.example",
        phone: "555-1000",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findFirst({
        where: { companyId: partnerAId, name: "Jane Roe" },
        select: {
          title: true,
          org: true,
          relevance: true,
          email: true,
          phone: true,
          linkedCompanyId: true,
        },
      }),
    );
    expect(row).toMatchObject({
      title: "Director",
      org: "State Housing",
      relevance: "Controls housing grants",
      email: "jane@housing.example",
      phone: "555-1000",
      linkedCompanyId: null,
    });
  });

  test("requires a contact name", async () => {
    await expect(
      addKeyRelationship(fd({ companyId: partnerAId, name: "  " })),
    ).rejects.toThrow("contact name is required");
  });

  test("refuses to add on a non-partner company", async () => {
    await expect(
      addKeyRelationship(fd({ companyId: memberAId, name: "Nope" })),
    ).rejects.toThrow("key relationships apply only to strategic partners");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      addKeyRelationship(fd({ companyId: partnerBId, name: "hijack" })),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.keyRelationship.count({ where: { companyId: partnerBId } }),
    );
    expect(count).toBe(1); // only the seeded Beta relationship
  });
});

describe("updateKeyRelationship / deleteKeyRelationship", () => {
  test("updates a relationship scoped to the tenant", async () => {
    const id = await seedRel({ name: "Editable" });
    await updateKeyRelationship(
      fd({ relationshipId: id, name: "Editable", title: "New Title" }),
    );
    const row = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({ where: { id }, select: { title: true } }),
    );
    expect(row!.title).toBe("New Title");
  });

  test("deletes a relationship scoped to the tenant", async () => {
    const id = await seedRel({ name: "Disposable" });
    await deleteKeyRelationship(fd({ relationshipId: id }));
    const gone = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses a relationship id from another tenant on update and delete", async () => {
    await expect(
      updateKeyRelationship(fd({ relationshipId: relBId, name: "hijacked" })),
    ).rejects.toThrow("relationship not found in this organization");
    await expect(
      deleteKeyRelationship(fd({ relationshipId: relBId })),
    ).rejects.toThrow("relationship not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.keyRelationship.findUnique({ where: { id: relBId }, select: { name: true } }),
    );
    expect(still!.name).toBe("Beta's contact");
  });
});

describe("linkKeyRelationship", () => {
  test("links to an in-org company and unlinks on blank", async () => {
    const id = await seedRel({ name: "Linkable" });

    await linkKeyRelationship(
      fd({ relationshipId: id, linkedCompanyId: memberAId }),
    );
    let row = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({
        where: { id },
        select: { linkedCompanyId: true },
      }),
    );
    expect(row!.linkedCompanyId).toBe(memberAId);

    await linkKeyRelationship(fd({ relationshipId: id, linkedCompanyId: "" }));
    row = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({
        where: { id },
        select: { linkedCompanyId: true },
      }),
    );
    expect(row!.linkedCompanyId).toBeNull();
  });

  test("refuses linking to a company in another tenant", async () => {
    const id = await seedRel({ name: "CrossLink" });
    await expect(
      linkKeyRelationship(fd({ relationshipId: id, linkedCompanyId: memberBId })),
    ).rejects.toThrow("linked company not found in this organization");

    const row = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({
        where: { id },
        select: { linkedCompanyId: true },
      }),
    );
    expect(row!.linkedCompanyId).toBeNull();
  });
});

describe("addRelationshipAsProspect", () => {
  test("promotes a relationship into a prospect company + primary contact, then links it", async () => {
    const id = await seedRel({
      name: "Sam Prospect",
      title: "VP",
      org: "Prospect Co",
      email: "sam@prospect.example",
      phone: "555-2000",
      relevance: "Wants to join",
    });

    await addRelationshipAsProspect(fd({ relationshipId: id }));

    const rel = await withOrg(orgA.id, (tx) =>
      tx.keyRelationship.findUnique({
        where: { id },
        select: { linkedCompanyId: true },
      }),
    );
    expect(rel!.linkedCompanyId).not.toBeNull();

    const prospect = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: rel!.linkedCompanyId! },
        select: {
          name: true,
          status: true,
          notes: true,
          contacts: {
            select: { name: true, title: true, email: true, isPrimary: true },
          },
        },
      }),
    );
    expect(prospect!.name).toBe("Prospect Co");
    expect(prospect!.status).toBe("prospect");
    expect(prospect!.notes).toContain("State Grant Office");
    expect(prospect!.notes).toContain("Wants to join");
    expect(prospect!.contacts).toHaveLength(1);
    expect(prospect!.contacts[0]).toMatchObject({
      name: "Sam Prospect",
      title: "VP",
      email: "sam@prospect.example",
      isPrimary: true,
    });
  });

  test("refuses when the relationship is already linked", async () => {
    const id = await seedRel({ name: "Already", org: "Some Org" });
    await linkKeyRelationship(
      fd({ relationshipId: id, linkedCompanyId: memberAId }),
    );
    await expect(
      addRelationshipAsProspect(fd({ relationshipId: id })),
    ).rejects.toThrow("already linked");
  });

  test("refuses a relationship id from another tenant", async () => {
    await expect(
      addRelationshipAsProspect(fd({ relationshipId: relBId })),
    ).rejects.toThrow("relationship not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.company.count({ where: { name: "Beta's contact" } }),
    );
    expect(count).toBe(0); // no prospect leaked into orgB
  });
});
