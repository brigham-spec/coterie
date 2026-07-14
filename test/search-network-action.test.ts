import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Integration test for the command-palette search action (searchNetwork). Runs
// against the real Neon DB, mocking only Clerk (requireOrgContext). Proves the
// action matches companies, contacts, and projects by name (case-insensitively),
// short-circuits on empty/single-char queries, and — the cardinal rule — that
// RLS keeps another tenant's identically-named records out of the results.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { searchNetwork } = await import("@/app/dashboard/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
const projectAId = randomUUID();
const companyBId = randomUUID();

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
        name: "Riverside Holdings",
        status: "member",
        industry: "Real Estate",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "River Stone",
        title: "Principal",
      },
    });
    await tx.project.create({
      data: {
        id: projectAId,
        orgId: orgA.id,
        name: "Riverfront Redevelopment",
        stage: "capital_raise",
      },
    });
    // A non-matching company, to prove the filter actually narrows.
    await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Acme Manufacturing",
        status: "prospect",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
  });

  // Foreign tenant with an identically-prefixed company that must never surface.
  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Riverbank Trust",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
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

describe("searchNetwork", () => {
  test("matches companies, contacts, and projects by name", async () => {
    const results = await searchNetwork("river");
    const byId = new Map(results.map((r) => [r.id, r]));

    const company = byId.get(companyAId);
    expect(company).toMatchObject({
      type: "company",
      label: "Riverside Holdings",
      href: `/dashboard/companies/${companyAId}`,
    });
    // Company sublabel is the industry when present.
    expect(company!.sublabel).toBe("Real Estate");

    expect(byId.get(contactAId)).toMatchObject({
      type: "contact",
      label: "River Stone",
      sublabel: "Principal \u00b7 Riverside Holdings",
      href: `/dashboard/contacts/${contactAId}`,
    });

    expect(byId.get(projectAId)).toMatchObject({
      type: "project",
      label: "Riverfront Redevelopment",
      sublabel: "Capital Raise",
      href: `/dashboard/projects/${projectAId}`,
    });

    // The non-matching company is excluded.
    expect(results.some((r) => r.label === "Acme Manufacturing")).toBe(false);
  });

  test("is case-insensitive", async () => {
    const results = await searchNetwork("RIVER");
    expect(results.map((r) => r.id)).toEqual(
      expect.arrayContaining([companyAId, contactAId, projectAId]),
    );
  });

  test("refuses to surface another tenant's identically-named record", async () => {
    const results = await searchNetwork("river");
    expect(results.some((r) => r.id === companyBId)).toBe(false);
    expect(results.some((r) => r.label === "Riverbank Trust")).toBe(false);
  });

  test("returns nothing for empty or single-character queries", async () => {
    expect(await searchNetwork("")).toEqual([]);
    expect(await searchNetwork("  ")).toEqual([]);
    expect(await searchNetwork("r")).toEqual([]);
  });
});
