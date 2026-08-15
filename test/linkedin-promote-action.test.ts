import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the LinkedIn promotion path (step 4). Runs
// against the real Neon DB, mocking only Clerk + next/cache. Proves the cardinal
// rules of a promotion: it find-or-creates the parent company by normalized name
// (never forking a near-duplicate), carries only STATED fields into the contact,
// is idempotent (a promoted connection is refused), is admin-gated, and never
// reaches across tenants.

const mockCtx = vi.hoisted(() => ({
  orgId: "",
  orgName: "",
  userId: "",
  userName: "",
  userEmail: "",
  role: "admin",
}));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { promoteLinkedinContact } = await import(
  "@/app/dashboard/linkedin/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const adminUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `admin_${randomUUID()}@example.com`,
  name: "Admin",
};

// Connections seeded per tenant; ids captured for the promote calls.
const ids = {
  ada: "",
  noCompany: "",
  existingCo: "",
  orgB: "",
};

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
    // A company already exists whose name normalizes to "analytical engines" —
    // the existingCo connection must REUSE it, not create a duplicate.
    await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Analytical  Engines",
        status: "member",
        industry: "Software",
        annualValue: "1000",
      },
    });

    const imp = await tx.linkedinImport.create({
      data: { orgId: orgA.id, rowCount: 3 },
      select: { id: true },
    });
    const mk = (data: {
      dedupeKey: string;
      firstName: string;
      lastName: string;
      fullName: string;
      company: string;
      title: string;
      email?: string;
      profileUrl?: string;
    }) =>
      tx.linkedinContact.create({
        data: {
          orgId: orgA.id,
          importId: imp.id,
          industry: "Finance",
          industrySource: "inferred",
          industryConfidence: "high",
          enrichedAt: new Date("2026-01-01T00:00:00Z"),
          ...data,
        },
        select: { id: true },
      });

    ids.ada = (
      await mk({
        dedupeKey: "url:linkedin.com/in/ada",
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        company: "Countess Ventures",
        title: "Chief Mathematician",
        email: "ada@example.com",
        profileUrl: "https://linkedin.com/in/ada",
      })
    ).id;
    ids.existingCo = (
      await mk({
        dedupeKey: "url:linkedin.com/in/charles",
        firstName: "Charles",
        lastName: "Babbage",
        fullName: "Charles Babbage",
        company: "Analytical Engines",
        title: "Engineer",
      })
    ).id;
    ids.noCompany = (
      await mk({
        dedupeKey: "url:linkedin.com/in/nocompany",
        firstName: "No",
        lastName: "Company",
        fullName: "No Company",
        company: "",
        title: "Freelancer",
      })
    ).id;
  });

  await withOrg(orgB.id, async (tx) => {
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgB.id, rowCount: 1 },
      select: { id: true },
    });
    ids.orgB = (
      await tx.linkedinContact.create({
        data: {
          orgId: orgB.id,
          importId: imp.id,
          dedupeKey: "url:linkedin.com/in/beta",
          firstName: "Beta",
          lastName: "Person",
          fullName: "Beta Person",
          company: "Beta Finance",
          title: "Analyst",
          enrichedAt: new Date("2026-01-03T00:00:00Z"),
        },
        select: { id: true },
      })
    ).id;
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = adminUser.id;
  mockCtx.userEmail = adminUser.email;
  mockCtx.role = "admin";
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  await prisma.user.deleteMany({ where: { id: adminUser.id } });
  await prisma.$disconnect();
});

function form(linkedinContactId: string): FormData {
  const f = new FormData();
  f.set("linkedinContactId", linkedinContactId);
  return f;
}

describe("promoteLinkedinContact", () => {
  test("creates a prospect company + contact, carrying only stated fields", async () => {
    const result = await promoteLinkedinContact({ status: "idle" }, form(ids.ada));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const contact = await withOrg(orgA.id, (tx) =>
      tx.contact.findUnique({
        where: { id: result.contactId },
        select: {
          name: true,
          title: true,
          email: true,
          linkedin: true,
          company: { select: { name: true, status: true, industry: true } },
        },
      }),
    );
    expect(contact?.name).toBe("Ada Lovelace");
    expect(contact?.title).toBe("Chief Mathematician");
    expect(contact?.email).toBe("ada@example.com");
    expect(contact?.linkedin).toBe("https://linkedin.com/in/ada");
    // New parent company seeded as a prospect (inferred industry NOT carried over).
    expect(contact?.company.name).toBe("Countess Ventures");
    expect(contact?.company.status).toBe("prospect");
    expect(contact?.company.industry).toBe("");

    // The connection is now stamped as promoted, pointing at the new contact.
    const connection = await withOrg(orgA.id, (tx) =>
      tx.linkedinContact.findUnique({
        where: { id: ids.ada },
        select: { promotedContactId: true, promotedAt: true },
      }),
    );
    expect(connection?.promotedContactId).toBe(result.contactId);
    expect(connection?.promotedAt).not.toBeNull();

    // The new company logged a status-changed activity, like a manual create.
    const activityCount = await withOrg(orgA.id, (tx) =>
      tx.activity.count({
        where: {
          company: { name: "Countess Ventures" },
          type: ACTIVITY_STATUS_CHANGED,
        },
      }),
    );
    expect(activityCount).toBe(1);
  });

  test("reuses an existing company by normalized name (no duplicate)", async () => {
    const before = await withOrg(orgA.id, (tx) =>
      tx.company.count({ where: { name: { contains: "Analytical" } } }),
    );
    const result = await promoteLinkedinContact(
      { status: "idle" },
      form(ids.existingCo),
    );
    expect(result.status).toBe("ok");
    const after = await withOrg(orgA.id, (tx) =>
      tx.company.count({ where: { name: { contains: "Analytical" } } }),
    );
    // Still exactly one "Analytical Engines" company — the promotion reused it.
    expect(after).toBe(before);
  });

  test("refuses a connection with no company on record", async () => {
    const result = await promoteLinkedinContact(
      { status: "idle" },
      form(ids.noCompany),
    );
    expect(result.status).toBe("error");
  });

  test("refuses to promote the same connection twice", async () => {
    const again = await promoteLinkedinContact({ status: "idle" }, form(ids.ada));
    expect(again.status).toBe("error");
  });

  test("refuses a non-admin", async () => {
    mockCtx.role = "staff";
    try {
      const result = await promoteLinkedinContact(
        { status: "idle" },
        form(ids.existingCo),
      );
      expect(result.status).toBe("error");
    } finally {
      mockCtx.role = "admin";
    }
  });

  test("never promotes another tenant's connection", async () => {
    // orgA context cannot resolve orgB's connection id — RLS hides it.
    const result = await promoteLinkedinContact({ status: "idle" }, form(ids.orgB));
    expect(result.status).toBe("error");
  });
});
