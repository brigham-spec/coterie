import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { IntroEmailInput } from "@/lib/intro-email";

// Action-level integration test for the draft-introduction-email helper (gap-audit
// cluster E). Exercises draftIntroEmail against the real Neon DB, mocking only the
// two external seams: Clerk (requireOrgContext) and the Anthropic engine. The
// load-bearing assertion inspects the input the action assembled — proving each
// party's profile is drawn from THIS tenant's contact and its company, never
// another tenant's rows, and that a foreign contact id is refused by RLS.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/intro-email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intro-email")>();
  return { ...actual, generateIntroEmail: genSpy };
});

const { draftIntroEmail } = await import("@/app/dashboard/introductions/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const builderCompanyId = randomUUID();
const aliceId = randomUUID();
const capitalCompanyId = randomUUID();
const rayId = randomUUID();

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
        id: builderCompanyId,
        orgId: orgA.id,
        name: "Hudson Builders",
        status: "member",
        industry: "Construction",
        annualValue: 1000,
        lookingFor: "capital partners",
        canOffer: "GC services",
        contacts: {
          create: {
            id: aliceId,
            orgId: orgA.id,
            name: "Alice Mason",
            title: "Principal",
            isPrimary: true,
          },
        },
      },
    });
    await tx.company.create({
      data: {
        id: capitalCompanyId,
        orgId: orgA.id,
        name: "Riverside Capital",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
        lookingFor: "development deals",
        canOffer: "construction lending",
        contacts: {
          create: {
            id: rayId,
            orgId: orgA.id,
            name: "Ray Cole",
            title: "Managing Director",
            isPrimary: true,
          },
        },
      },
    });
  });

  // Org B: its own company + contact — must stay invisible to the draft.
  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Beta Corp",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
        contacts: {
          create: { id: contactBId, orgId: orgB.id, name: "Other Person" },
        },
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userName = "Brigham Farrand";
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

describe("draftIntroEmail", () => {
  test("assembles both parties' grounded profiles for the model", async () => {
    genSpy.mockResolvedValue({ subject: "Alice, meet Ray", body: "Connecting you." });

    const state = await draftIntroEmail(
      { status: "idle" },
      fd({
        partyAContactId: aliceId,
        partyBContactId: rayId,
        context: "for the Mill Redevelopment",
      }),
    );
    expect(state).toEqual({
      status: "ok",
      draft: { subject: "Alice, meet Ray", body: "Connecting you." },
    });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const input = genSpy.mock.calls[0][0] as IntroEmailInput;

    expect(input.orgName).toBe(orgA.name);
    expect(input.host).toBe("Brigham Farrand");
    expect(input.context).toBe("for the Mill Redevelopment");

    expect(input.partyA).toEqual({
      name: "Alice Mason",
      org: "Hudson Builders",
      title: "Principal",
      industry: "Construction",
      seeking: "capital partners",
      brings: "GC services",
    });
    expect(input.partyB).toEqual({
      name: "Ray Cole",
      org: "Riverside Capital",
      title: "Managing Director",
      industry: "Finance",
      seeking: "development deals",
      brings: "construction lending",
    });
  });

  test("refuses a contact id from another tenant (RLS → not found)", async () => {
    const state = await draftIntroEmail(
      { status: "idle" },
      fd({ partyAContactId: aliceId, partyBContactId: contactBId, context: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "contact not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("rejects the same contact on both sides before any load", async () => {
    const state = await draftIntroEmail(
      { status: "idle" },
      fd({ partyAContactId: aliceId, partyBContactId: aliceId, context: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Select two different contacts.",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("returns an error when the model gives nothing usable", async () => {
    genSpy.mockResolvedValue(null);
    const state = await draftIntroEmail(
      { status: "idle" },
      fd({ partyAContactId: aliceId, partyBContactId: rayId, context: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not draft an email. Try again.",
    });
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await draftIntroEmail(
      { status: "idle" },
      fd({ partyAContactId: aliceId, partyBContactId: rayId, context: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not draft an email. Try again.",
    });
  });
});
