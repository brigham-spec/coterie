import { describe, it, expect } from "vitest";

import {
  INTRO_STAGES,
  PRE_INTRO_STAGES,
  INTRO_LIFECYCLE,
  TERMINAL_INTRO_STAGES,
  getIntroStageDef,
  introStageRank,
  normalizeIntroStatus,
  isIntroStage,
} from "@/lib/intro-stages";

// Unit test for the canonical introduction lifecycle vocabulary (slice 11.4a).
// Pure logic, no DB. Guards the ledger's stage set, ordering, the unknown-value
// fallbacks the UI relies on, and the legacy-status normalization.

describe("introduction lifecycle vocabulary", () => {
  it("composes the full vocabulary as pre-intro then lifecycle", () => {
    expect(INTRO_STAGES.map((s) => s.value)).toEqual([
      "suggested",
      "drafted",
      "made",
      "connected",
      "meeting_set",
      "collaborating",
      "value_created",
      "dormant",
    ]);
    expect(INTRO_STAGES).toHaveLength(
      PRE_INTRO_STAGES.length + INTRO_LIFECYCLE.length,
    );
  });

  it("marks value_created and dormant as terminal", () => {
    expect([...TERMINAL_INTRO_STAGES]).toEqual(["value_created", "dormant"]);
  });

  it("resolves a known stage to its full definition", () => {
    const def = getIntroStageDef("meeting_set");
    expect(def.label).toBe("Meeting Set");
    expect(def.tone).toBe("gold");
  });

  it("falls back to a neutral slate badge carrying the raw value", () => {
    expect(getIntroStageDef("legacy_x")).toEqual({
      value: "legacy_x",
      label: "legacy_x",
      tone: "slate",
    });
  });

  it("ranks stages by lifecycle position", () => {
    expect(introStageRank("suggested")).toBe(0);
    expect(introStageRank("dormant")).toBe(INTRO_STAGES.length - 1);
    expect(introStageRank("made")).toBeLessThan(introStageRank("value_created"));
  });

  it("sorts unknown stages last", () => {
    expect(introStageRank("mystery")).toBe(INTRO_STAGES.length);
    expect(introStageRank("mystery")).toBeGreaterThan(introStageRank("dormant"));
  });

  it("validates stage membership for the write boundary", () => {
    expect(isIntroStage("suggested")).toBe(true);
    expect(isIntroStage("value_created")).toBe(true);
    expect(isIntroStage("mystery")).toBe(false);
    expect(isIntroStage("")).toBe(false);
    // Legacy values are not canonical → rejected at the boundary (callers
    // normalize on read, but writes must use the canonical vocabulary).
    expect(isIntroStage("meeting_held")).toBe(false);
  });

  it("normalizes legacy statuses and passes canonical ones through", () => {
    expect(normalizeIntroStatus("meeting_held")).toBe("meeting_set");
    expect(normalizeIntroStatus("closed")).toBe("dormant");
    // Canonical values are unchanged → idempotent.
    expect(normalizeIntroStatus("made")).toBe("made");
    expect(normalizeIntroStatus("value_created")).toBe("value_created");
    // An unknown value is left as-is (no accidental collapse).
    expect(normalizeIntroStatus("mystery")).toBe("mystery");
  });
});
