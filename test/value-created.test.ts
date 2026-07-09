import { describe, it, expect } from "vitest";

import {
  ZERO_IMPACT,
  computeValueSummary,
  facilitatedValue,
  impactIsEmpty,
  isActiveStage,
  parseEconomicImpact,
  parseServices,
  type ValueCompany,
  type ValueProject,
} from "@/lib/value-created";

// Unit test for the Value Created PURE rollup (slice 11.8). No DB — guards the
// defensive Json coercers (economic_impact / services arrive untyped from Postgres)
// and the attribution math: member-connected vs multi-member counts, facilitated
// sum, active pipeline, service-fee revenue, ARR-based network multiplier, and the
// per-project impact aggregation.

function project(over: Partial<ValueProject> = {}): ValueProject {
  return {
    id: over.id ?? "p1",
    name: over.name ?? "Project",
    stage: over.stage ?? "prospect",
    county: over.county ?? null,
    description: over.description ?? null,
    value: over.value ?? null,
    realizedValue: over.realizedValue ?? null,
    memberNames: over.memberNames ?? [],
    stageHistory: over.stageHistory ?? [],
    economicImpact: over.economicImpact ?? ZERO_IMPACT,
  };
}

function company(over: Partial<ValueCompany> = {}): ValueCompany {
  return {
    id: over.id ?? "c1",
    name: over.name ?? "Company",
    contactName: over.contactName ?? null,
    industry: over.industry ?? null,
    annualValue: over.annualValue ?? 0,
    services: over.services ?? { ida: null, capital: null },
  };
}

describe("parseEconomicImpact", () => {
  it("coerces numbers and numeric strings, ignores the rest", () => {
    const out = parseEconomicImpact({
      permanentJobs: 40,
      constructionJobs: "25",
      constructionCost: "1000000",
      bogus: "x",
    });
    expect(out.permanentJobs).toBe(40);
    expect(out.constructionJobs).toBe(25);
    expect(out.constructionCost).toBe(1_000_000);
  });

  it("counts tax abatement only when active", () => {
    expect(
      parseEconomicImpact({ taxAbatement: { active: true, totalValue: 500 } })
        .taxAbatementValue,
    ).toBe(500);
    expect(
      parseEconomicImpact({ taxAbatement: { active: false, totalValue: 500 } })
        .taxAbatementValue,
    ).toBe(0);
  });

  it("sums only awarded/received grants, case-insensitively", () => {
    const out = parseEconomicImpact({
      grants: [
        { status: "Awarded", amount: 100 },
        { status: "RECEIVED", amount: 200 },
        { status: "applied", amount: 999 },
        { amount: 5 },
      ],
    });
    expect(out.grantsSecured).toBe(300);
  });

  it("reads malformed / missing shapes as all-zero", () => {
    expect(parseEconomicImpact(null)).toEqual(ZERO_IMPACT);
    expect(parseEconomicImpact("nope")).toEqual(ZERO_IMPACT);
    expect(parseEconomicImpact([1, 2, 3])).toEqual(ZERO_IMPACT);
    expect(parseEconomicImpact({ grants: "not-array" }).grantsSecured).toBe(0);
  });
});

describe("impactIsEmpty", () => {
  it("is true only when every field is zero", () => {
    expect(impactIsEmpty(ZERO_IMPACT)).toBe(true);
    expect(impactIsEmpty({ ...ZERO_IMPACT, permanentJobs: 1 })).toBe(false);
  });
});

describe("parseServices", () => {
  it("returns null for inactive or absent lines", () => {
    expect(parseServices(null)).toEqual({ ida: null, capital: null });
    expect(parseServices({ ida: { active: false } }).ida).toBeNull();
  });

  it("surfaces an active line with its fee and secured value", () => {
    const { ida } = parseServices({
      ida: { active: true, status: "engaged", serviceFee: 5000, valueSecured: 250000 },
    });
    expect(ida).toEqual({
      active: true,
      status: "engaged",
      serviceFee: 5000,
      valueSecured: 250000,
    });
  });

  it("falls back to amountPlaced when valueSecured is unset (capital line)", () => {
    const { capital } = parseServices({
      capital: { active: true, amountPlaced: 750000 },
    });
    expect(capital?.valueSecured).toBe(750000);
  });
});

describe("facilitatedValue", () => {
  it("prefers realized, then pipeline estimate, then zero", () => {
    expect(facilitatedValue(project({ realizedValue: 900, value: 100 }))).toBe(900);
    expect(facilitatedValue(project({ value: 100 }))).toBe(100);
    expect(facilitatedValue(project())).toBe(0);
  });
});

describe("isActiveStage", () => {
  it("treats terminal stages as inactive", () => {
    expect(isActiveStage("prospect")).toBe(true);
    expect(isActiveStage("completed")).toBe(false);
    expect(isActiveStage("on_hold")).toBe(false);
  });
});

describe("computeValueSummary", () => {
  it("counts member-connected and multi-member deals", () => {
    const s = computeValueSummary(
      [
        project({ id: "a", memberNames: [] }),
        project({ id: "b", memberNames: ["One"] }),
        project({ id: "c", memberNames: ["One", "Two"] }),
      ],
      [],
    );
    expect(s.memberConnectedCount).toBe(2);
    expect(s.multiMemberCount).toBe(1);
    expect(s.multiMemberDeals.map((p) => p.id)).toEqual(["c"]);
  });

  it("sums facilitated value over member-connected projects only", () => {
    const s = computeValueSummary(
      [
        project({ memberNames: [], value: 1_000_000 }), // excluded (no member)
        project({ memberNames: ["One"], realizedValue: 500_000 }),
        project({ memberNames: ["One", "Two"], value: 300_000 }),
      ],
      [],
    );
    expect(s.facilitatedValue).toBe(800_000);
  });

  it("counts only non-terminal member-connected projects in active pipeline", () => {
    const s = computeValueSummary(
      [
        project({ memberNames: ["One"], stage: "prospect", value: 100 }),
        project({ memberNames: ["One"], stage: "completed", value: 900 }),
      ],
      [],
    );
    expect(s.activePipelineValue).toBe(100);
  });

  it("sums IDA + capital service fees and flags active-service companies", () => {
    const withServices = company({
      id: "svc",
      services: {
        ida: { active: true, status: "", serviceFee: 5000, valueSecured: 0 },
        capital: { active: true, status: "", serviceFee: 8000, valueSecured: 0 },
      },
    });
    const s = computeValueSummary([], [withServices, company({ id: "plain" })]);
    expect(s.serviceFeeRevenue).toBe(13000);
    expect(s.activeServices.map((c) => c.id)).toEqual(["svc"]);
  });

  it("computes the network multiplier as facilitated / ARR, null when either is zero", () => {
    const members = [company({ annualValue: 100_000 }), company({ annualValue: 100_000 })];
    const withValue = computeValueSummary(
      [project({ memberNames: ["One"], value: 400_000 })],
      members,
    );
    expect(withValue.totalArr).toBe(200_000);
    expect(withValue.networkMultiplier).toBe(2);

    expect(computeValueSummary([], members).networkMultiplier).toBeNull();
    expect(
      computeValueSummary(
        [project({ memberNames: ["One"], value: 400_000 })],
        [],
      ).networkMultiplier,
    ).toBeNull();
  });

  it("aggregates economic impact across every project", () => {
    const s = computeValueSummary(
      [
        project({ economicImpact: { ...ZERO_IMPACT, permanentJobs: 10, grantsSecured: 100 } }),
        project({ economicImpact: { ...ZERO_IMPACT, permanentJobs: 5, constructionCost: 999 } }),
      ],
      [],
    );
    expect(s.impact.permanentJobs).toBe(15);
    expect(s.impact.grantsSecured).toBe(100);
    expect(s.impact.constructionCost).toBe(999);
  });

  it("sorts multi-member deals and single-member pipeline by facilitated value desc", () => {
    const s = computeValueSummary(
      [
        project({ id: "lo", memberNames: ["A", "B"], value: 100 }),
        project({ id: "hi", memberNames: ["A", "B"], value: 900 }),
        project({ id: "solo-active", memberNames: ["A"], stage: "prospect", value: 50 }),
        project({ id: "solo-big", memberNames: ["A"], stage: "prospect", value: 500 }),
        project({ id: "solo-done", memberNames: ["A"], stage: "completed", value: 999 }),
      ],
      [],
    );
    expect(s.multiMemberDeals.map((p) => p.id)).toEqual(["hi", "lo"]);
    expect(s.memberConnectedPipeline.map((p) => p.id)).toEqual(["solo-big", "solo-active"]);
  });

  it("returns an all-zero summary for empty inputs", () => {
    const s = computeValueSummary([], []);
    expect(s.facilitatedValue).toBe(0);
    expect(s.memberConnectedCount).toBe(0);
    expect(s.multiMemberCount).toBe(0);
    expect(s.serviceFeeRevenue).toBe(0);
    expect(s.totalArr).toBe(0);
    expect(s.networkMultiplier).toBeNull();
    expect(impactIsEmpty(s.impact)).toBe(true);
    expect(s.multiMemberDeals).toEqual([]);
    expect(s.memberConnectedPipeline).toEqual([]);
    expect(s.activeServices).toEqual([]);
  });
});
