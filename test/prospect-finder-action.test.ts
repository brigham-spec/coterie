import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { ProspectSearchInput, ProspectTarget } from "@/lib/prospect-finder";

// Action-level integration test for the prospect finder (slice 11.6). Exercises
// both server actions against the real Neon DB — mocking only the external seams:
//   • findProspects: mock Clerk + the web-search engine, assert the network
//     CONTEXT handed to the engine is tenant-scoped (own active firms only; former
//     excluded; existing prospects excluded from results but members drive gaps).
//   • addProspect: NOT mocked — proves a real prospect + primary contact are
//     persisted in the caller's tenant, and that re-adding the same org is a no-op.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prospect-finder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prospect-finder")>();
  return { ...actual, generateProspectTargets: genSpy };
});

const { findProspects, addProspect } = await import(
  "@/app/dashboard/prospect-finder/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const base = { industry: "test", annualValue: 1000 };

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
        orgId: orgA.id,
        name: "Member A",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
        lookingFor: "a capital partner",
        canOffer: "land-use counsel",
      },
    });
    await tx.company.create({
      data: { orgId: orgA.id, name: "Prospect A", status: "prospect", ...base },
    });
    await tx.company.create({
      data: { orgId: orgA.id, name: "Former A", status: "former", ...base },
    });
    await tx.project.create({
      data: { orgId: orgA.id, name: "Active A", stage: "concept", type: "Mixed-Use", county: "Ulster" },
    });
  });

  await withOrg(orgB.id, (tx) =>
    tx.company.create({ data: { orgId: orgB.id, name: "Member B", status: "member", ...base } }),
  );

  mockCtx.orgId = orgA.id;
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

describe("findProspects action", () => {
  test("hands the engine only the caller's own scoped network context", async () => {
    genSpy.mockResolvedValue([]);

    const state = await findProspects({ status: "idle" }, fd({ mode: "recommendations" }));
    expect(state).toEqual({ status: "ok", mode: "recommendations", targets: [] });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const input = genSpy.mock.calls[0][0] as ProspectSearchInput;

    // members = in-network firms only (member/partner) — not the prospect, not
    // the former member, and never org B.
    const memberNames = input.members.map((m) => m.name);
    expect(memberNames).toContain("Member A");
    expect(memberNames).not.toContain("Prospect A");
    expect(memberNames).not.toContain("Former A");
    expect(memberNames).not.toContain("Member B");

    // needs = firms with a stated looking-for/can-offer.
    expect(input.needs.map((n) => n.name)).toEqual(["Member A"]);

    // excludeOrgs = every non-former org in the tenant (so we never re-surface an
    // existing prospect) — but not the former member, not org B.
    expect(input.excludeOrgs).toContain("Member A");
    expect(input.excludeOrgs).toContain("Prospect A");
    expect(input.excludeOrgs).not.toContain("Former A");
    expect(input.excludeOrgs).not.toContain("Member B");

    // active projects only, from this tenant.
    expect(input.projects.map((p) => p.name)).toEqual(["Active A"]);
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await findProspects({ status: "idle" }, fd({ mode: "targeted" }));
    expect(state).toEqual({
      status: "error",
      message: "Could not search for prospects. Try again.",
    });
  });
});

describe("addProspect action", () => {
  const target: ProspectTarget = {
    org: "Hudson Timber Co",
    contact: "Dana Rivers",
    title: "Managing Partner",
    industry: "Construction",
    county: "Dutchess",
    why: "fills a construction gap",
    theyGet: "senior peers",
    theyBring: "mass-timber expertise",
    connectWith: "Member A",
    whyNow: "just broke ground on a HV project",
    website: "https://hudsontimber.example",
    score: 4,
  };

  test("persists a new prospect with its primary contact, then dedupes", async () => {
    const first = await addProspect(target);
    expect(first.status).toBe("added");

    const created = await withOrg(orgA.id, (tx) =>
      tx.company.findFirst({
        where: { name: "Hudson Timber Co" },
        include: { contacts: true },
      }),
    );
    expect(created?.status).toBe("prospect");
    expect(created?.source).toBe("Prospect Finder");
    expect(created?.temperature).toBe(80); // score 4 -> 4*20
    expect(created?.counties).toEqual(["Dutchess"]);
    expect(created?.lookingFor).toBe("senior peers");
    expect(created?.canOffer).toBe("mass-timber expertise");
    expect(created?.contacts).toHaveLength(1);
    expect(created?.contacts[0]).toMatchObject({
      name: "Dana Rivers",
      title: "Managing Partner",
      isPrimary: true,
    });

    // Re-adding the same org (case-insensitive) is a no-op.
    const again = await addProspect({ ...target, org: "hudson timber co" });
    expect(again.status).toBe("exists");
  });

  test("the persisted prospect is invisible to another tenant (RLS)", async () => {
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.company.findMany({ where: { name: "Hudson Timber Co" } }),
    );
    expect(seenByB).toEqual([]);
  });
});
