import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the LinkedIn recall search (step 3). Runs
// against the real Neon DB, mocking only Clerk. Proves the cardinal rules of the
// recall layer: only ENRICHED rows are searchable (un-enriched rows are invisible
// by construction), the search is admin-gated, and one tenant never sees another's
// connections.

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

const { searchLinkedin } = await import("@/app/dashboard/linkedin/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const adminUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `admin_${randomUUID()}@example.com`,
  name: "Admin",
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
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgA.id, rowCount: 3 },
      select: { id: true },
    });
    // Ada: enriched finance connection — SHOULD surface for a finance query.
    await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: imp.id,
        dedupeKey: "url:linkedin.com/in/ada",
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        company: "Analytical Engines",
        title: "Chief Mathematician",
        industry: "Finance",
        industrySource: "inferred",
        industryConfidence: "high",
        enrichedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    // Grace: enriched but in a different industry — should NOT match finance.
    await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: imp.id,
        dedupeKey: "url:linkedin.com/in/grace",
        firstName: "Grace",
        lastName: "Hopper",
        fullName: "Grace Hopper",
        company: "US Navy",
        title: "Rear Admiral",
        industry: "Defense",
        industrySource: "inferred",
        industryConfidence: "low",
        enrichedAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    // Fin: a finance connection that is NOT yet enriched — invisible to recall.
    await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: imp.id,
        dedupeKey: "url:linkedin.com/in/fin",
        firstName: "Fin",
        lastName: "Ance",
        fullName: "Fin Ance",
        company: "Finance Capital",
        title: "Finance Partner",
        // enrichedAt null → un-enriched
      },
    });
  });

  // orgB has its own enriched finance connection to prove isolation.
  await withOrg(orgB.id, async (tx) => {
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgB.id, rowCount: 1 },
      select: { id: true },
    });
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
        industry: "Finance",
        industrySource: "inferred",
        industryConfidence: "high",
        enrichedAt: new Date("2026-01-03T00:00:00Z"),
      },
    });
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

function queryForm(query: string): FormData {
  const f = new FormData();
  f.set("query", query);
  return f;
}

describe("searchLinkedin", () => {
  test("returns only enriched matches, marking inferred provenance", async () => {
    const result = await searchLinkedin(
      { status: "idle" },
      queryForm("who do i know that works in finance"),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // Only the 2 enriched rows were searched (Fin is invisible).
    expect(result.searched).toBe(2);

    // Ada (Finance industry) matches; Grace (Defense) does not; Fin (finance
    // company + title but UN-ENRICHED) never enters the pool.
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].row.fullName).toBe("Ada Lovelace");
    expect(result.hits[0].matched).toContain("industry");
    expect(result.hits[0].row.industryConfidence).toBe("high");
  });

  test("errors on an empty query", async () => {
    const result = await searchLinkedin({ status: "idle" }, queryForm("   "));
    expect(result.status).toBe("error");
  });

  test("errors when the query is only question scaffolding", async () => {
    const result = await searchLinkedin(
      { status: "idle" },
      queryForm("who do i know"),
    );
    expect(result.status).toBe("error");
  });

  test("refuses a non-admin and searches nothing", async () => {
    mockCtx.role = "staff";
    try {
      const result = await searchLinkedin(
        { status: "idle" },
        queryForm("finance"),
      );
      expect(result.status).toBe("error");
    } finally {
      mockCtx.role = "admin";
    }
  });

  test("never returns another tenant's connections", async () => {
    const result = await searchLinkedin({ status: "idle" }, queryForm("finance"));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // orgB's "Beta Person" (also Finance, enriched) must never appear for orgA.
    expect(result.hits.every((h) => h.row.fullName !== "Beta Person")).toBe(true);
  });
});
