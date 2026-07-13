import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { PartnerSynthInput } from "@/lib/partner-synth";

// Action-level integration test for the P6a partnership slice (updatePartnership
// + synthesizePartner). Runs against the real Neon DB, mocking only Clerk
// (requireOrgContext), Next's revalidatePath, and the Anthropic engine. Proves
// the field write, the strategic_partner-only guard, that a foreign company id is
// refused by RLS, and that the synthesis input is grounded in this partner (with
// unsaved form values winning over the stored row).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/partner-synth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/partner-synth")>();
  return { ...actual, generatePartnerSynthesis: genSpy };
});

const { updatePartnership, synthesizePartner } = await import(
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

// orgA has a partner and a plain member; orgB has its own partner (foreign target).
const partnerAId = randomUUID();
const memberAId = randomUUID();
const partnerBId = randomUUID();

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
        website: "https://grants.example",
        contacts: {
          create: { orgId: orgA.id, name: "Pat Partner", isPrimary: true },
        },
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

beforeEach(() => {
  genSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updatePartnership", () => {
  test("saves the partnership fields on a strategic partner", async () => {
    await updatePartnership(
      fd({
        companyId: partnerAId,
        website: "https://grants.example/new",
        partnerCategory: "Government Agency",
        partnerRelationship: "State grant administrator",
        partnerSummary: "Runs the regional grant program.",
        collaborationNotes: "Co-hosting a grant workshop.",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: partnerAId },
        select: {
          website: true,
          partnerCategory: true,
          partnerRelationship: true,
          partnerSummary: true,
          collaborationNotes: true,
        },
      }),
    );
    expect(row).toMatchObject({
      website: "https://grants.example/new",
      partnerCategory: "Government Agency",
      partnerRelationship: "State grant administrator",
      partnerSummary: "Runs the regional grant program.",
      collaborationNotes: "Co-hosting a grant workshop.",
    });
  });

  test("refuses to write partnership fields on a non-partner company", async () => {
    await expect(
      updatePartnership(
        fd({ companyId: memberAId, partnerCategory: "Government Agency" }),
      ),
    ).rejects.toThrow("partnership details apply only to strategic partners");

    const row = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: memberAId },
        select: { partnerCategory: true },
      }),
    );
    expect(row!.partnerCategory).toBe("");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      updatePartnership(
        fd({ companyId: partnerBId, partnerCategory: "hijack" }),
      ),
    ).rejects.toThrow("company not found in this organization");

    const row = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({
        where: { id: partnerBId },
        select: { partnerCategory: true },
      }),
    );
    expect(row!.partnerCategory).toBe("");
  });
});

describe("synthesizePartner", () => {
  test("grounds the model in this partner, with unsaved form values winning", async () => {
    genSpy.mockResolvedValue({
      category: "Government Agency",
      summary: "Who they are.",
      collaboration: "Work together on X.",
    });

    const state = await synthesizePartner(
      { status: "idle" },
      fd({
        companyId: partnerAId,
        website: "https://typed-but-unsaved.example",
        partnerRelationship: "Freshly typed relationship",
      }),
    );
    expect(state.status).toBe("ok");

    expect(genSpy).toHaveBeenCalledTimes(1);
    const arg = genSpy.mock.calls[0][0] as PartnerSynthInput;
    expect(arg.orgName).toBe(orgA.name);
    expect(arg.companyName).toBe("State Grant Office");
    expect(arg.contactName).toBe("Pat Partner");
    // The form-supplied values win over the stored row.
    expect(arg.website).toBe("https://typed-but-unsaved.example");
    expect(arg.relationship).toBe("Freshly typed relationship");
  });

  test("refuses synthesis on a non-partner company", async () => {
    const state = await synthesizePartner(
      { status: "idle" },
      fd({ companyId: memberAId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "partnership synthesis applies only to strategic partners",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await synthesizePartner(
      { status: "idle" },
      fd({ companyId: partnerBId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("returns an error when the model gives nothing usable", async () => {
    genSpy.mockResolvedValue(null);
    const state = await synthesizePartner(
      { status: "idle" },
      fd({ companyId: partnerAId, website: "https://x.example" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not synthesize a brief. Try again.",
    });
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await synthesizePartner(
      { status: "idle" },
      fd({ companyId: partnerAId, website: "https://x.example" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not synthesize a brief. Try again.",
    });
  });
});
