import { describe, it, expect } from "vitest";

import {
  PROJECT_STAGES,
  TERMINAL_STAGES,
  BOARD_STAGES,
  getStageDef,
  stageRank,
} from "@/lib/project-stages";

// Unit test for the canonical project pipeline vocabulary (slice 11.3, spec §3.6).
// Pure logic, no DB. Guards the board's column set, ordering, and the unknown-
// value fallbacks the UI relies on.

describe("project stage vocabulary", () => {
  it("defines the ten canonical stages in flow order", () => {
    expect(PROJECT_STAGES.map((s) => s.value)).toEqual([
      "concept",
      "pre_development",
      "entitlements",
      "planning_board",
      "capital_raise",
      "construction_docs",
      "under_construction",
      "stabilization",
      "completed",
      "on_hold",
    ]);
  });

  it("marks completed and on_hold as terminal", () => {
    expect([...TERMINAL_STAGES]).toEqual(["completed", "on_hold"]);
  });

  it("builds the board from every stage except completed", () => {
    const boardValues = BOARD_STAGES.map((s) => s.value);
    expect(boardValues).not.toContain("completed");
    // On-hold IS a board column; only completed is pulled out.
    expect(boardValues).toContain("on_hold");
    expect(boardValues).toHaveLength(PROJECT_STAGES.length - 1);
  });

  it("resolves a known stage to its full definition", () => {
    const def = getStageDef("under_construction");
    expect(def.label).toBe("Under Construction");
    expect(def.tone).toBe("teal");
  });

  it("falls back to a neutral slate badge carrying the raw value", () => {
    const def = getStageDef("legacy_open");
    expect(def).toEqual({
      value: "legacy_open",
      label: "legacy_open",
      tone: "slate",
    });
  });

  it("ranks stages by pipeline position", () => {
    expect(stageRank("concept")).toBe(0);
    expect(stageRank("on_hold")).toBe(PROJECT_STAGES.length - 1);
    expect(stageRank("concept")).toBeLessThan(stageRank("completed"));
  });

  it("sorts unknown stages last", () => {
    expect(stageRank("mystery")).toBe(PROJECT_STAGES.length);
    expect(stageRank("mystery")).toBeGreaterThan(stageRank("on_hold"));
  });
});
