import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { EnrichWebContext, WebEnrichment } from "@/lib/enrich-web";

// Action-level integration test for enrich-from-web (gap-audit cluster E). Runs
// against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateWebEnrichment). Proves the
// enrich action grounds the model in THIS company's own profile fields (never
// another tenant's), and that applyWebEnrichment writes only the selected fields —
// splitting counties into the array column and appending notes with a dated
// header — into THIS tenant, and refuses a foreign company id.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/enrich-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/enrich-web")>();
  return { ...actual, generateWebEnrichment: genSpy };
});

const { enrichFromWebAction, applyWebEnrichment } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
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
        annualValue: 1000,
        website: "https://acmemills.example",
        counties: ["Ulster"],
        notes: "Existing note.",
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Jane Doe",
        isPrimary: true,
      },
    });
  });

  // Org B: its own company — must stay invisible to org A's actions.
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

describe("enrichFromWebAction", () => {
  test("grounds the model in this company's own profile fields", async () => {
    const enrichment: WebEnrichment = {
      summary: "Public filings show a new Kingston site.",
      lookingFor: "growth capital",
      canOffer: "manufacturing capacity",
      industry: "Advanced Manufacturing",
      counties: "Ulster, Dutchess",
      dealSize: "$5M-$20M",
      agencyContacts: "Ulster County IDA",
      notesAppend: "Announced a Series B raise.",
    };
    genSpy.mockResolvedValue(enrichment);

    const state = await enrichFromWebAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({ status: "ok", enrichment });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as EnrichWebContext;
    expect(context.orgName).toBe("Acme Mills");
    expect(context.companyName).toBe("Acme Mills");
    expect(context.contactName).toBe("Jane Doe");
    expect(context.industry).toBe("Manufacturing");
    expect(context.counties).toEqual(["Ulster"]);
    expect(context.website).toBe("https://acmemills.example");
  });

  test("surfaces an empty parse as a 'nothing new' error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await enrichFromWebAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "No new profile details found on the web.",
    });
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await enrichFromWebAction(
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

describe("applyWebEnrichment", () => {
  test("writes only the selected fields, splits counties, and appends notes", async () => {
    const selection = {
      lookingFor: "growth capital",
      counties: "Ulster, Dutchess",
      agencyContacts: "Ulster County IDA",
      notesAppend: "Announced a Series B raise.",
    };
    const state = await applyWebEnrichment(
      { status: "idle" },
      fd({ companyId: companyAId, enrichment: JSON.stringify(selection) }),
    );
    expect(state).toEqual({ status: "applied", count: 4 });

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          lookingFor: true,
          canOffer: true,
          counties: true,
          agencyContacts: true,
          notes: true,
        },
      }),
    );
    expect(company!.lookingFor).toBe("growth capital");
    expect(company!.counties).toEqual(["Ulster", "Dutchess"]);
    expect(company!.agencyContacts).toBe("Ulster County IDA");
    // canOffer was NOT selected → left untouched (null).
    expect(company!.canOffer).toBeNull();
    // The original note is preserved and the append carries a dated [Web] header.
    expect(company!.notes).toContain("Existing note.");
    expect(company!.notes).toContain("Announced a Series B raise.");
    expect(company!.notes).toMatch(/\[Web, \d{4}-\d{2}-\d{2}\]:/);
  });

  test("rejects an empty selection", async () => {
    const state = await applyWebEnrichment(
      { status: "idle" },
      fd({ companyId: companyAId, enrichment: JSON.stringify({}) }),
    );
    expect(state).toEqual({ status: "error", message: "Nothing selected to apply." });
  });

  test("refuses to write to another tenant's company (RLS → not found)", async () => {
    const state = await applyWebEnrichment(
      { status: "idle" },
      fd({
        companyId: companyBId,
        enrichment: JSON.stringify({ lookingFor: "leaked" }),
      }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({ where: { id: companyBId }, select: { lookingFor: true } }),
    );
    expect(companyB!.lookingFor).toBeNull();
  });
});
