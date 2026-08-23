import { describe, it, expect } from "vitest";

import {
  INTRO_DISMISS_REASONS,
  isIntroDismissReason,
} from "@/lib/intro-dismissal";

// Unit test for the intro-dismissal vocabulary. Pure logic, no DB. Guards the
// reason set the dashboard disposition picker and the dismissIntro write-boundary
// both speak through.

describe("intro-dismissal vocabulary", () => {
  it("defines the four disposition reasons in order", () => {
    expect(INTRO_DISMISS_REASONS.map((r) => r.value)).toEqual([
      "not_relevant",
      "competitor",
      "wrong_timing",
      "other",
    ]);
    expect(INTRO_DISMISS_REASONS.map((r) => r.label)).toEqual([
      "Not relevant",
      "Competitor",
      "Wrong timing",
      "Other",
    ]);
  });

  it("validates reason membership for the write boundary", () => {
    expect(isIntroDismissReason("not_relevant")).toBe(true);
    expect(isIntroDismissReason("competitor")).toBe(true);
    expect(isIntroDismissReason("wrong_timing")).toBe(true);
    expect(isIntroDismissReason("other")).toBe(true);
    expect(isIntroDismissReason("already_connected")).toBe(false);
    expect(isIntroDismissReason("mystery")).toBe(false);
    expect(isIntroDismissReason("")).toBe(false);
  });
});
