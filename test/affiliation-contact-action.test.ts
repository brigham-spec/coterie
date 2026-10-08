import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the affiliation→contact link. Runs against
// the real Neon DB, mocking only Clerk (requireOrgContext) and revalidatePath.
// Proves addAffiliation/updateAffiliation store a contactId only when it belongs
// to the member company+org, and that a contact from another company (or tenant)
// is dropped to null rather than linked.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { addAffiliation, updateAffiliation } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const otherCompanyAId = randomUUID();
const contactAId = randomUUID();
const otherContactAId = randomUUID();
const companyBId = randomUUID();
const contactBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
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
    await tx.company.create({
      data: {
        id: otherCompanyAId,
        orgId: orgA.id,
        name: "Other Acme Co",
        status: "member",
        industry: "Retail",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Jane Doe",
      },
    });
    // A contact that belongs to a DIFFERENT company in the same org.
    await tx.contact.create({
      data: {
        id: otherContactAId,
        orgId: orgA.id,
        companyId: otherCompanyAId,
        name: "Someone Else",
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
    await tx.contact.create({
      data: {
        id: contactBId,
        orgId: orgB.id,
        companyId: companyBId,
        name: "Bob Beta",
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addAffiliation with a contact", () => {
  test("links a contact that belongs to the member company", async () => {
    await addAffiliation(
      fd({
        companyId: companyAId,
        name: "Acme Logistics",
        contactId: contactAId,
      }),
    );
    const row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findFirst({
        where: { companyId: companyAId, name: "Acme Logistics" },
        select: { contactId: true },
      }),
    );
    expect(row!.contactId).toBe(contactAId);
  });

  test("drops a contact from another company in the same org to null", async () => {
    await addAffiliation(
      fd({
        companyId: companyAId,
        name: "Acme Foreign-Contact",
        contactId: otherContactAId,
      }),
    );
    const row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findFirst({
        where: { companyId: companyAId, name: "Acme Foreign-Contact" },
        select: { contactId: true },
      }),
    );
    expect(row!.contactId).toBeNull();
  });

  test("drops a contact from another tenant to null", async () => {
    await addAffiliation(
      fd({
        companyId: companyAId,
        name: "Acme Cross-Tenant",
        contactId: contactBId,
      }),
    );
    const row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findFirst({
        where: { companyId: companyAId, name: "Acme Cross-Tenant" },
        select: { contactId: true },
      }),
    );
    expect(row!.contactId).toBeNull();
  });
});

describe("updateAffiliation with a contact", () => {
  test("sets then clears the contact link", async () => {
    const affiliationId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.affiliation.create({
        data: {
          id: affiliationId,
          orgId: orgA.id,
          companyId: companyAId,
          name: "Acme Ventures",
        },
      }),
    );

    await updateAffiliation(
      fd({ affiliationId, name: "Acme Ventures", contactId: contactAId }),
    );
    let row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findUnique({
        where: { id: affiliationId },
        select: { contactId: true },
      }),
    );
    expect(row!.contactId).toBe(contactAId);

    // Empty contactId clears the link.
    await updateAffiliation(
      fd({ affiliationId, name: "Acme Ventures", contactId: "" }),
    );
    row = await withOrg(orgA.id, (tx) =>
      tx.affiliation.findUnique({
        where: { id: affiliationId },
        select: { contactId: true },
      }),
    );
    expect(row!.contactId).toBeNull();
  });
});
