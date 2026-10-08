import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { SecondaryProfileContext } from "@/lib/secondary-profile";

// Action-level integration test for the secondary-profile flow
// (enrichSecondaryProfile + applySecondaryProfile + updateSecondaryProfile). Runs
// against the real Neon DB, mocking only Clerk (requireOrgContext) and the
// Anthropic engine (generateSecondaryProfile). Proves enrich grounds the model in
// THIS company's affiliations + documents, refuses a foreign company id, applies
// only the selected fields, and that the manual edit trims + saves.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/secondary-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/secondary-profile")>();
  return { ...actual, generateSecondaryProfile: genSpy };
});

const { enrichSecondaryProfile, applySecondaryProfile, updateSecondaryProfile } =
  await import("@/app/dashboard/companies/[id]/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
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
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        lookingFor: "Capital",
        canOffer: "Precision machining",
        annualValue: 1000,
      },
    });
    await tx.affiliation.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        name: "Acme Logistics",
        role: "Founder",
        industry: "Transportation",
        canOffer: "Fleet capacity",
        lookingFor: "Warehouse partners",
      },
    });
    await tx.companyDocument.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        fileName: "deck.pdf",
        summary: "A cold-storage expansion plan.",
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
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("enrichSecondaryProfile", () => {
  test("grounds the model in this company's affiliations + documents", async () => {
    genSpy.mockResolvedValue({
      secondaryIndustry: "Logistics",
      secondaryCanOffer: "Fleet capacity",
      secondaryLookingFor: "Cold-storage partners",
    });

    const state = await enrichSecondaryProfile(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({
      status: "ok",
      proposal: {
        secondaryIndustry: "Logistics",
        secondaryCanOffer: "Fleet capacity",
        secondaryLookingFor: "Cold-storage partners",
      },
    });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as SecondaryProfileContext;
    expect(context.companyName).toBe("Acme Mills");
    expect(context.primaryIndustry).toBe("Manufacturing");
    expect(context.affiliations).toEqual([
      {
        name: "Acme Logistics",
        role: "Founder",
        industry: "Transportation",
        canOffer: "Fleet capacity",
        lookingFor: "Warehouse partners",
      },
    ]);
    expect(context.documentSummaries).toEqual(["A cold-storage expansion plan."]);
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await enrichSecondaryProfile(
      { status: "idle" },
      fd({ companyId: companyBId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("applySecondaryProfile", () => {
  test("writes only the selected fields", async () => {
    const state = await applySecondaryProfile(
      { status: "idle" },
      fd({
        companyId: companyAId,
        proposal: JSON.stringify({
          secondaryIndustry: "Logistics",
          secondaryLookingFor: "Cold-storage partners",
        }),
      }),
    );
    expect(state).toEqual({ status: "applied", count: 2 });

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          secondaryIndustry: true,
          secondaryCanOffer: true,
          secondaryLookingFor: true,
        },
      }),
    );
    expect(company).toMatchObject({
      secondaryIndustry: "Logistics",
      secondaryCanOffer: null,
      secondaryLookingFor: "Cold-storage partners",
    });
  });

  test("refuses a company id from another tenant", async () => {
    const state = await applySecondaryProfile(
      { status: "idle" },
      fd({
        companyId: companyBId,
        proposal: JSON.stringify({ secondaryIndustry: "leak" }),
      }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
  });
});

describe("updateSecondaryProfile", () => {
  test("trims and saves the three fields", async () => {
    await updateSecondaryProfile(
      fd({
        companyId: companyAId,
        secondaryIndustry: "  Real estate  ",
        secondaryCanOffer: "Buildings",
        secondaryLookingFor: "",
      }),
    );
    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          secondaryIndustry: true,
          secondaryCanOffer: true,
          secondaryLookingFor: true,
        },
      }),
    );
    expect(company).toMatchObject({
      secondaryIndustry: "Real estate",
      secondaryCanOffer: "Buildings",
      secondaryLookingFor: "",
    });
  });
});
