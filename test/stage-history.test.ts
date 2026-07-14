import { describe, expect, test } from "vitest";

import { buildStageTimeline } from "@/lib/stage-history";

// Unit tests for buildStageTimeline — the pure reader over a project's
// stage_history JSON. No DB: it only shapes the trail updateStage writes into an
// ordered timeline with days-in-stage, so every case is a plain input/output.

const now = new Date("2026-07-14T12:00:00.000Z");

describe("buildStageTimeline", () => {
  test("returns nothing for missing or non-array history", () => {
    expect(buildStageTimeline(null, now)).toEqual([]);
    expect(buildStageTimeline(undefined, now)).toEqual([]);
    expect(buildStageTimeline("concept", now)).toEqual([]);
    expect(buildStageTimeline([], now)).toEqual([]);
  });

  test("orders transitions and spans each to the next (current spans to now)", () => {
    const timeline = buildStageTimeline(
      [
        { stage: "capital_raise", date: "2026-04-01", ts: 1 },
        { stage: "concept", date: "2026-01-01", ts: 2 },
      ],
      now,
    );

    expect(timeline).toEqual([
      {
        stage: "concept",
        label: "Concept",
        tone: "slate",
        date: "2026-01-01",
        days: 90, // 2026-01-01 -> 2026-04-01
        isCurrent: false,
      },
      {
        stage: "capital_raise",
        label: "Capital Raise",
        tone: "gold",
        date: "2026-04-01",
        days: 104, // 2026-04-01 -> 2026-07-14
        isCurrent: true,
      },
    ]);
  });

  test("a transition dated today reads as zero days in the current stage", () => {
    const timeline = buildStageTimeline(
      [{ stage: "completed", date: "2026-07-14" }],
      now,
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ isCurrent: true, days: 0 });
  });

  test("drops malformed entries and falls back to the raw label for unknown stages", () => {
    const timeline = buildStageTimeline(
      [
        { stage: "concept", date: "not-a-date" },
        { stage: 42, date: "2026-02-01" },
        "garbage",
        null,
        { stage: "mothballed", date: "2026-02-01" },
      ],
      now,
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      stage: "mothballed",
      label: "mothballed",
      tone: "slate",
      isCurrent: true,
    });
  });
});
