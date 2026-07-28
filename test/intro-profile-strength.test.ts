import { describe, it, expect } from "vitest";

import {
  introProfileStrength,
  isProfileIncomplete,
  type ProfileStrengthSignals,
} from "@/lib/intro-profile-strength";

// Unit test for the introduction engine's profile-strength heuristic (S6c, item
// 19). Pure scoring — guards the weight table, the Sparse/Fair/Strong buckets, the
// weight-ordered missing list, and the "worth showing" nudge gate.

function signals(over: Partial<ProfileStrengthSignals>): ProfileStrengthSignals {
  return {
    canOffer: false,
    lookingFor: false,
    hasProjects: false,
    hasIndustry: false,
    hasPrimaryContact: false,
    ...over,
  };
}

describe("introProfileStrength", () => {
  it("is 0 and Sparse for an empty profile, missing everything in weight order", () => {
    const s = introProfileStrength(signals({}));
    expect(s.score).toBe(0);
    expect(s.label).toBe("Sparse");
    expect(s.missing).toEqual([
      "what they need",
      "what they offer",
      "active work",
      "industry",
      "a primary contact",
    ]);
  });

  it("is 100 and Strong with nothing missing when every signal is present", () => {
    const s = introProfileStrength(
      signals({
        canOffer: true,
        lookingFor: true,
        hasProjects: true,
        hasIndustry: true,
        hasPrimaryContact: true,
      }),
    );
    expect(s.score).toBe(100);
    expect(s.label).toBe("Strong");
    expect(s.missing).toEqual([]);
  });

  it("classifies needs+offers alone as Fair (60) and lists the rest as missing", () => {
    const s = introProfileStrength(signals({ canOffer: true, lookingFor: true }));
    expect(s.score).toBe(60);
    expect(s.label).toBe("Fair");
    expect(s.missing).toEqual(["active work", "industry", "a primary contact"]);
  });

  it("crosses into Strong at 80 (offer+need+projects)", () => {
    const s = introProfileStrength(
      signals({ canOffer: true, lookingFor: true, hasProjects: true }),
    );
    expect(s.score).toBe(80);
    expect(s.label).toBe("Strong");
  });
});

describe("isProfileIncomplete", () => {
  it("is true below the strong threshold and false at/above it", () => {
    expect(isProfileIncomplete(introProfileStrength(signals({})))).toBe(true);
    expect(
      isProfileIncomplete(
        introProfileStrength(
          signals({ canOffer: true, lookingFor: true, hasProjects: true }),
        ),
      ),
    ).toBe(false);
  });
});
