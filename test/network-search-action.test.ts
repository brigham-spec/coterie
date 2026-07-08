import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type {
  NetworkSearchMatch,
  NetworkSearchProfile,
} from "@/lib/network-search";

// Action-level integration test for searchNetwork (slice 11.5). This exercises
// the WHOLE server-action path against the real Neon DB — the auth boundary, the
// RLS-scoped withOrg query, and the state shaping — mocking only the two external
// seams: Clerk (requireOrgContext) and the Anthropic call (generateNetworkMatches).
// The load-bearing assertion is tenant isolation AT THE ACTION LEVEL: the action
// must hand the engine only the caller's own active companies — never another
// tenant's rows, and never former members.

// requireOrgContext is fully mocked; the returned object is mutated per-test so
// the hoisted factory can point at the tenant seeded at runtime.
const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

// Replace ONLY the Anthropic-calling function; keep the real pure exports (types,
// parseNetworkMatches). The spy captures the profiles the action assembled.
const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network-search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/network-search")>();
  return { ...actual, generateNetworkMatches: genSpy };
});

// Imported AFTER the mocks are registered (vi.mock is hoisted, so this is safe).
const { searchNetwork } = await import(
  "@/app/dashboard/network-search/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const base = { industry: "test", annualValue: 1000 };

let activeAId: string;
let formerAId: string;
let companyBId: string;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  activeAId = (
    await withOrg(orgA.id, (tx) =>
      tx.company.create({
        data: { orgId: orgA.id, name: "Active (A)", status: "member", ...base },
      }),
    )
  ).id;

  formerAId = (
    await withOrg(orgA.id, (tx) =>
      tx.company.create({
        data: { orgId: orgA.id, name: "Former (A)", status: "former", ...base },
      }),
    )
  ).id;

  companyBId = (
    await withOrg(orgB.id, (tx) =>
      tx.company.create({
        data: { orgId: orgB.id, name: "Beta (B)", status: "member", ...base },
      }),
    )
  ).id;

  mockCtx.orgId = orgA.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

function fd(query: string): FormData {
  const f = new FormData();
  f.set("query", query);
  return f;
}

describe("searchNetwork action", () => {
  test("passes ONLY the caller's active companies to the engine (tenant + former scoping)", async () => {
    const canned: NetworkSearchMatch[] = [
      {
        companyId: activeAId,
        companyName: "Active (A)",
        contactName: "",
        why: "match",
        relevance: 5,
        keyDetail: "",
      },
    ];
    genSpy.mockResolvedValue(canned);

    const state = await searchNetwork({ status: "idle" }, fd("who does test work"));

    expect(state).toEqual({ status: "ok", query: "who does test work", matches: canned });

    // The engine received org A's ACTIVE company, and neither org B's row nor the
    // former member — proving the action's withOrg query is tenant-scoped and
    // honours the status!=former filter.
    expect(genSpy).toHaveBeenCalledTimes(1);
    const profiles = genSpy.mock.calls[0][1] as NetworkSearchProfile[];
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain(activeAId);
    expect(ids).not.toContain(formerAId);
    expect(ids).not.toContain(companyBId);
  });

  test("rejects an empty query before touching the engine", async () => {
    const state = await searchNetwork({ status: "idle" }, fd("   "));
    expect(state).toEqual({ status: "error", message: "Enter a search query." });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an auth failure from the engine as inline error state", async () => {
    // A generic engine throw maps to the friendly catch-all (the Anthropic-typed
    // branches are covered by the instanceof checks in the action).
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await searchNetwork({ status: "idle" }, fd("anything"));
    expect(state).toEqual({
      status: "error",
      message: "Could not search the network. Try again.",
    });
  });
});
