import { describe, it, expect } from "vitest";

import {
  INTRO_CONNECTION_TYPES,
  PIPELINE_STALE_DAYS,
  conversionRate,
  daysInStage,
  filterByStage,
  isConnectionType,
  isIntroStale,
  pipelineFunnel,
  stageChips,
} from "@/lib/intro-pipeline";

// Unit test for the introductions pipeline shaping (S6a). Pure logic, no DB.
// Guards the funnel counts, the stage-filter chips (empty stages hidden), the
// >30-day stale rule (terminal stages never stale), and the connection-type
// vocabulary the write boundary enforces.

const NOW = new Date("2026-07-24T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("connection-type vocabulary", () => {
  it("accepts a known label and the empty (unset) value", () => {
    expect(isConnectionType("Deal Flow")).toBe(true);
    expect(isConnectionType("")).toBe(true);
  });

  it("rejects an out-of-vocabulary label", () => {
    expect(isConnectionType("Made Up")).toBe(false);
  });

  it("exposes the full taxonomy", () => {
    expect(INTRO_CONNECTION_TYPES).toContain("Capital & Financing");
    expect(INTRO_CONNECTION_TYPES.length).toBe(8);
  });
});

describe("daysInStage / isIntroStale", () => {
  it("floors whole days since the last change", () => {
    expect(daysInStage(daysAgo(0), NOW)).toBe(0);
    expect(daysInStage(daysAgo(31), NOW)).toBe(31);
  });

  it("flags a non-terminal row past the stale threshold", () => {
    expect(isIntroStale("made", daysAgo(PIPELINE_STALE_DAYS + 1), NOW)).toBe(true);
    expect(isIntroStale("made", daysAgo(PIPELINE_STALE_DAYS), NOW)).toBe(false);
  });

  it("never flags a terminal stage as stale", () => {
    expect(isIntroStale("value_created", daysAgo(400), NOW)).toBe(false);
    expect(isIntroStale("dormant", daysAgo(400), NOW)).toBe(false);
  });
});

describe("pipelineFunnel", () => {
  it("counts each made-onward stage and omits pre-intro states", () => {
    const funnel = pipelineFunnel([
      { status: "suggested" },
      { status: "made" },
      { status: "made" },
      { status: "value_created" },
    ]);
    expect(funnel.map((c) => c.value)).not.toContain("suggested");
    const made = funnel.find((c) => c.value === "made");
    expect(made?.count).toBe(2);
    const won = funnel.find((c) => c.value === "value_created");
    expect(won?.count).toBe(1);
  });
});

describe("conversionRate", () => {
  it("is the value_created share as a whole percent", () => {
    expect(
      conversionRate([
        { status: "made" },
        { status: "made" },
        { status: "made" },
        { status: "value_created" },
      ]),
    ).toBe(25);
  });

  it("is 0 with no introductions", () => {
    expect(conversionRate([])).toBe(0);
  });
});

describe("stageChips", () => {
  it("leads with All and hides stages that have no rows", () => {
    const chips = stageChips([
      { status: "made" },
      { status: "made" },
      { status: "value_created" },
    ]);
    expect(chips[0]).toEqual({ value: "", label: "All", count: 3 });
    const values = chips.map((c) => c.value);
    expect(values).toContain("made");
    expect(values).toContain("value_created");
    expect(values).not.toContain("dormant");
  });
});

describe("filterByStage", () => {
  const rows = [
    { status: "made", id: "a" },
    { status: "value_created", id: "b" },
  ];

  it("keeps only the matching stage", () => {
    expect(filterByStage(rows, "made").map((r) => r.id)).toEqual(["a"]);
  });

  it("returns everything for the All (empty) filter", () => {
    expect(filterByStage(rows, "").length).toBe(2);
  });

  it("returns everything for an unknown stage", () => {
    expect(filterByStage(rows, "bogus").length).toBe(2);
  });
});
