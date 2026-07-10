import { describe, expect, test } from "vitest";

import {
  evaluateRateLimit,
  type RateCaps,
  type RateWindows,
} from "@/lib/ai-rate-limit";

// Pure-logic tests for the AI rate-limit window/cap arithmetic: the fresh (null)
// org, incrementing under cap, refusal at each cap without mutating the counts,
// and the two windows resetting independently when their start has elapsed.

// Small caps so the boundaries are easy to reason about.
const caps: RateCaps = {
  minuteCap: 3,
  minuteMs: 60_000,
  dayCap: 5,
  dayMs: 86_400_000,
};

const NOW = 1_000_000_000_000;

function windows(over: Partial<RateWindows>): RateWindows {
  return {
    minuteStart: over.minuteStart ?? NOW,
    minuteCount: over.minuteCount ?? 0,
    dayStart: over.dayStart ?? NOW,
    dayCount: over.dayCount ?? 0,
  };
}

describe("evaluateRateLimit", () => {
  test("first-ever call (null) is allowed and opens both windows at 1", () => {
    const d = evaluateRateLimit(null, NOW, caps);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({
      minuteStart: NOW,
      minuteCount: 1,
      dayStart: NOW,
      dayCount: 1,
    });
  });

  test("under both caps increments each count", () => {
    const d = evaluateRateLimit(windows({ minuteCount: 1, dayCount: 2 }), NOW, caps);
    expect(d.allowed).toBe(true);
    expect(d.next.minuteCount).toBe(2);
    expect(d.next.dayCount).toBe(3);
  });

  test("at the minute cap refuses and leaves counts untouched", () => {
    const current = windows({ minuteCount: 3, dayCount: 3 });
    const d = evaluateRateLimit(current, NOW, caps);
    expect(d.allowed).toBe(false);
    expect(d.next).toEqual(current);
  });

  test("at the day cap refuses even when the minute window is fresh", () => {
    const current = windows({ minuteCount: 0, dayCount: 5 });
    const d = evaluateRateLimit(current, NOW, caps);
    expect(d.allowed).toBe(false);
    expect(d.next.dayCount).toBe(5);
  });

  test("an elapsed minute window resets that count and allows again", () => {
    // Minute maxed but its window is a minute old; the day count still has room.
    const current = windows({
      minuteStart: NOW - 60_000,
      minuteCount: 3,
      dayStart: NOW - 60_000,
      dayCount: 3,
    });
    const d = evaluateRateLimit(current, NOW, caps);
    expect(d.allowed).toBe(true);
    // Minute rolled to a new window (count 1), day kept accumulating (4).
    expect(d.next).toEqual({
      minuteStart: NOW,
      minuteCount: 1,
      dayStart: NOW - 60_000,
      dayCount: 4,
    });
  });

  test("an elapsed day window resets the day count independently", () => {
    const current = windows({
      minuteStart: NOW,
      minuteCount: 1,
      dayStart: NOW - 86_400_000,
      dayCount: 5,
    });
    const d = evaluateRateLimit(current, NOW, caps);
    expect(d.allowed).toBe(true);
    expect(d.next.dayStart).toBe(NOW);
    expect(d.next.dayCount).toBe(1);
    // The minute window had not elapsed, so it just incremented.
    expect(d.next.minuteCount).toBe(2);
  });
});
