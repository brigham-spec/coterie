import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { WhyJoinInput } from "@/lib/why-join";

// Action-level integration test for the why-join pitch (gap-audit cluster E).
// Exercises generateWhyJoin against the real Neon DB, mocking only the two
// external seams: Clerk (requireOrgContext) and the Anthropic engine. The
// load-bearing assertion inspects the input the action assembled — proving the
// pitch is grounded in THIS tenant's members and active projects, never another
// tenant's rows, and that a foreign prospect id is refused by RLS.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/why-join", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/why-join")>();
  return { ...actual, generateWhyJoinPitch: genSpy };
});

const { generateWhyJoin } = await import("@/app/dashboard/companies/[id]/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const prospectId = randomUUID();
const memberId = randomUUID();
const activeProjectId = randomUUID();
const doneProjectId = randomUUID();
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
        id: prospectId,
        orgId: orgA.id,
        name: "Riverside Capital",
        status: "prospect",
        industry: "Finance",
        annualValue: 0,
        lookingFor: "development deals",
        canOffer: "construction lending",
      },
    });
    await tx.company.create({
      data: {
        id: memberId,
        orgId: orgA.id,
        name: "Hudson Builders",
        status: "member",
        industry: "Construction",
        annualValue: 1000,
        lookingFor: "capital partners",
        canOffer: "GC services",
        contacts: {
          create: { orgId: orgA.id, name: "Alice Mason", isPrimary: true },
        },
      },
    });
    await tx.project.create({
      data: {
        id: activeProjectId,
        orgId: orgA.id,
        name: "Mill Redevelopment",
        stage: "capital_raise",
        type: "mixed-use",
      },
    });
    // A completed (terminal) project must NOT surface as an open opportunity.
    await tx.project.create({
      data: {
        id: doneProjectId,
        orgId: orgA.id,
        name: "Finished Tower",
        stage: "completed",
        type: "residential",
      },
    });
  });

  // Org B: its own member — must stay invisible to the pitch.
  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Beta Corp",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
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

describe("generateWhyJoin", () => {
  test("assembles this tenant's grounded network context for the model", async () => {
    genSpy.mockResolvedValue({
      headline: "Join.",
      networkValue: "",
      trackRecord: "",
      openRoles: "",
      industryPosition: "",
      topIntros: [],
      emailSubject: "",
      emailBody: "Come join.",
    });

    const state = await generateWhyJoin({ status: "idle" }, fd({ companyId: prospectId }));
    expect(state.status).toBe("ok");

    expect(genSpy).toHaveBeenCalledTimes(1);
    const input = genSpy.mock.calls[0][0] as WhyJoinInput;

    expect(input.orgName).toBe(orgA.name);
    expect(input.host).toBe("Brigham Farrand");
    expect(input.prospect.name).toBe("Riverside Capital");
    expect(input.prospect.seeking).toBe("development deals");
    expect(input.prospect.brings).toBe("construction lending");

    // Members: this tenant's member only (with its primary contact as the person),
    // never org B's member.
    expect(input.members.map((m) => m.name)).toEqual(["Alice Mason"]);
    expect(input.members[0].org).toBe("Hudson Builders");
    expect(input.members.some((m) => m.org === "Beta Corp")).toBe(false);

    // memberCount and the sector read reflect only this tenant's members.
    expect(input.memberCount).toBe(1);
    expect(input.industryPresence).toContain("Finance");

    // Open opportunities: the active project only; the completed one is excluded.
    expect(input.openRoles.some((r) => r.includes("Mill Redevelopment"))).toBe(true);
    expect(input.openRoles.some((r) => r.includes("Finished Tower"))).toBe(false);
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await generateWhyJoin({ status: "idle" }, fd({ companyId: companyBId }));
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("returns an error when the model gives nothing usable", async () => {
    genSpy.mockResolvedValue(null);
    const state = await generateWhyJoin({ status: "idle" }, fd({ companyId: prospectId }));
    expect(state).toEqual({
      status: "error",
      message: "Could not write a pitch. Try again.",
    });
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await generateWhyJoin({ status: "idle" }, fd({ companyId: prospectId }));
    expect(state).toEqual({
      status: "error",
      message: "Could not write a pitch. Try again.",
    });
  });
});
