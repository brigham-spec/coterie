import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the bulk importer (previewImport +
// commitImport). Runs against the real Neon DB, mocking only Clerk and Next's
// revalidatePath. Proves that preview classifies new-vs-existing companies and
// duplicate emails without writing; that commit creates new rows, REUSES an
// existing company by name (no duplicate) and SKIPS a duplicate email; that the
// admin gate refuses a non-admin; and — the cardinal rule — that the other
// tenant is untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({
  orgId: "",
  orgName: "",
  userId: "",
  userName: "",
  role: "admin",
}));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { previewImport, commitImport } = await import(
  "@/app/dashboard/companies/import/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const adminUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `admin_${randomUUID()}@example.com`,
  name: "Admin",
};

const existingCompanyId = randomUUID();
const companyBId = randomUUID();

// Existing tenant state: one company + one contact whose email must be treated
// as a duplicate on import.
const CSV = `company_name,status,industry,annual_value,contact_name,email
Existing Co,member,Finance,,Jane Existing,jane@existing.com
New Alpha,prospect,Tech,25000,Alph One,alpha@new.com
New Alpha,prospect,Tech,,Alph Two,dup@existing.com`;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: adminUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: adminUser.id, role: "admin" },
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: existingCompanyId,
        orgId: orgA.id,
        name: "Existing Co",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: {
        orgId: orgA.id,
        companyId: existingCompanyId,
        name: "Dup Person",
        email: "dup@existing.com",
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
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = adminUser.id;
  mockCtx.role = "admin";
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: adminUser.id } });
  await prisma.$disconnect();
});

function csvForm(text: string): FormData {
  const f = new FormData();
  f.set("csv", text);
  return f;
}

describe("previewImport", () => {
  test("classifies companies and duplicate emails without writing", async () => {
    const before = await withOrg(orgA.id, (tx) => tx.company.count());

    const preview = await previewImport({ status: "idle" }, csvForm(CSV));
    expect(preview.status).toBe("ok");
    if (preview.status !== "ok") return;

    expect(preview.counts).toMatchObject({
      companiesNew: 1,
      companiesExisting: 1,
      contactsCreate: 2,
      contactsDuplicate: 1,
      rowErrors: 0,
    });
    const byName = Object.fromEntries(
      preview.companies.map((c) => [c.name, c.state]),
    );
    expect(byName["Existing Co"]).toBe("existing");
    expect(byName["New Alpha"]).toBe("new");

    const after = await withOrg(orgA.id, (tx) => tx.company.count());
    expect(after).toBe(before); // no writes
  });

  test("errors on empty input", async () => {
    const preview = await previewImport({ status: "idle" }, csvForm("  "));
    expect(preview.status).toBe("error");
  });
});

describe("commitImport", () => {
  test("creates new rows, reuses the existing company, skips the dup email", async () => {
    const result = await commitImport({ status: "idle" }, csvForm(CSV));
    expect(result).toEqual({
      status: "ok",
      companiesCreated: 1,
      contactsCreated: 2,
      contactsSkipped: 1,
    });

    const state = await withOrg(orgA.id, async (tx) => {
      const existingCos = await tx.company.count({ where: { name: "Existing Co" } });
      const newAlpha = await tx.company.findFirst({ where: { name: "New Alpha" } });
      const alphaContacts = newAlpha
        ? await tx.contact.count({ where: { companyId: newAlpha.id } })
        : 0;
      const dupContacts = await tx.contact.count({
        where: { email: "dup@existing.com" },
      });
      const janeContacts = await tx.contact.count({
        where: { email: "jane@existing.com", companyId: existingCompanyId },
      });
      return { existingCos, newAlpha, alphaContacts, dupContacts, janeContacts };
    });

    expect(state.existingCos).toBe(1); // reused, not duplicated
    expect(state.newAlpha).not.toBeNull();
    expect(state.alphaContacts).toBe(1); // alpha@new.com only (dup skipped)
    expect(state.dupContacts).toBe(1); // still just the seeded one
    expect(state.janeContacts).toBe(1); // new contact on the existing company
  });

  test("leaves the other tenant untouched", async () => {
    const beta = await withOrg(orgB.id, async (tx) => ({
      total: await tx.company.count(),
      alpha: await tx.company.count({ where: { name: "New Alpha" } }),
    }));
    expect(beta.total).toBe(1);
    expect(beta.alpha).toBe(0);
  });
});

describe("admin gate", () => {
  test("refuses a non-admin and writes nothing", async () => {
    mockCtx.role = "staff";
    try {
      const before = await withOrg(orgA.id, (tx) => tx.company.count());
      const preview = await previewImport({ status: "idle" }, csvForm(CSV));
      expect(preview.status).toBe("error");
      const result = await commitImport({ status: "idle" }, csvForm(CSV));
      expect(result.status).toBe("error");
      const after = await withOrg(orgA.id, (tx) => tx.company.count());
      expect(after).toBe(before);
    } finally {
      mockCtx.role = "admin";
    }
  });
});
