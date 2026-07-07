import { describe, it, expect } from "vitest";

import {
  eligibleCandidateIds,
  candidateSignalScore,
  prioritizeCandidates,
  parseSuggestions,
  pairKey,
  parseProactivePairings,
  type IntroCompanyProfile,
} from "@/lib/intro-engine";

// Unit test for the per-member introduction engine's PURE surface (slice 11.4b).
// No DB, no Anthropic call — guards the eligibility filter, the signal heuristic
// used to bound the prompt, and the defensive parser that rejects hallucinated or
// malformed model output. The AI call itself (generateIntroSuggestions) is the
// single impure seam and is exercised at runtime, not here.

function profile(over: Partial<IntroCompanyProfile>): IntroCompanyProfile {
  return {
    id: "x",
    name: "X",
    status: "member",
    industry: null,
    tier: null,
    lookingFor: null,
    canOffer: null,
    networkTags: [],
    counties: [],
    primaryContact: null,
    projects: [],
    ...over,
  };
}

describe("eligibleCandidateIds", () => {
  it("excludes the focus itself and already-introduced companies", () => {
    const out = eligibleCandidateIds(
      "focus",
      ["focus", "a", "b", "c"],
      new Set(["b"]),
    );
    expect(out).toEqual(["a", "c"]);
  });

  it("returns everything when nothing is introduced and focus is absent", () => {
    expect(eligibleCandidateIds("focus", ["a", "b"], new Set())).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("candidateSignalScore", () => {
  it("is zero for an empty profile", () => {
    expect(candidateSignalScore(profile({}))).toBe(0);
  });

  it("rewards needs, offers, tags, projects, and a contact, capping tags/projects at 3", () => {
    const p = profile({
      lookingFor: "capital",
      canOffer: "land",
      networkTags: ["a", "b", "c", "d"],
      projects: [
        { name: "p1", stage: "concept", role: "developer" },
        { name: "p2", stage: "concept", role: "developer" },
        { name: "p3", stage: "concept", role: "developer" },
        { name: "p4", stage: "concept", role: "developer" },
      ],
      primaryContact: { name: "Jo", title: null },
    });
    // 2 + 2 + min(4,3) + min(4,3) + 1 = 11
    expect(candidateSignalScore(p)).toBe(11);
  });

  it("ignores whitespace-only needs/offers", () => {
    expect(
      candidateSignalScore(profile({ lookingFor: "   ", canOffer: "" })),
    ).toBe(0);
  });
});

describe("prioritizeCandidates", () => {
  it("sorts by signal desc, breaks ties by name, and caps to the limit", () => {
    const strong = profile({ id: "s", name: "Strong", lookingFor: "x", canOffer: "y" });
    const weak = profile({ id: "w", name: "Weak" });
    const midB = profile({ id: "b", name: "Beta", lookingFor: "x" });
    const midA = profile({ id: "a", name: "Alpha", lookingFor: "x" });
    const out = prioritizeCandidates([weak, midB, strong, midA], 3);
    expect(out.map((c) => c.id)).toEqual(["s", "a", "b"]);
  });
});

describe("parseSuggestions", () => {
  const valid = new Set(["a", "b"]);

  it("parses a clean array, dropping hallucinated ids and sorting by score", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: 3, talkingPoints: ["one"] },
      { companyId: "ghost", companyName: "Ghost", score: 5 },
      { companyId: "b", companyName: "B", score: 5 },
    ]);
    const out = parseSuggestions(raw, valid);
    expect(out.map((s) => s.companyId)).toEqual(["b", "a"]);
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Here you go:\n```json\n[{"companyId":"a","companyName":"A","score":4}]\n```\nDone.';
    const out = parseSuggestions(raw, valid);
    expect(out).toHaveLength(1);
    expect(out[0].companyId).toBe("a");
  });

  it("clamps score into 2..5 and trims talking points to 3", () => {
    const raw = JSON.stringify([
      {
        companyId: "a",
        companyName: "A",
        score: 9,
        talkingPoints: ["1", "  ", "2", "3", "4"],
      },
    ]);
    const [s] = parseSuggestions(raw, valid);
    expect(s.score).toBe(5);
    expect(s.talkingPoints).toEqual(["1", "2", "3"]);
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseSuggestions("not json at all", valid)).toEqual([]);
    expect(parseSuggestions("{}", valid)).toEqual([]);
    expect(parseSuggestions('{"companyId":"a"}', valid)).toEqual([]);
  });

  it("drops entries with a non-finite score", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: "oops" },
    ]);
    expect(parseSuggestions(raw, valid)).toEqual([]);
  });
});

describe("pairKey", () => {
  it("is orientation-independent", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    expect(pairKey("a", "b")).toBe("a|b");
  });
});

describe("parseProactivePairings", () => {
  const valid = new Set(["a", "b", "c"]);
  const noExclusions = new Set<string>();

  function pairing(over: Record<string, unknown>) {
    return {
      companyAId: "a",
      companyAName: "A",
      companyBId: "b",
      companyBName: "B",
      score: 4,
      ...over,
    };
  }

  it("parses valid pairings and sorts by score desc", () => {
    const raw = JSON.stringify([
      pairing({ companyAId: "a", companyBId: "b", score: 3 }),
      pairing({ companyAId: "b", companyBId: "c", score: 5 }),
    ]);
    const out = parseProactivePairings(raw, valid, noExclusions);
    expect(out.map((p) => p.score)).toEqual([5, 3]);
  });

  it("drops pairings with a hallucinated, self, or duplicate-of-self id", () => {
    const raw = JSON.stringify([
      pairing({ companyAId: "a", companyBId: "ghost" }),
      pairing({ companyAId: "a", companyBId: "a" }),
    ]);
    expect(parseProactivePairings(raw, valid, noExclusions)).toEqual([]);
  });

  it("excludes already-made / dismissed pairs regardless of orientation", () => {
    const excluded = new Set([pairKey("a", "b")]);
    const raw = JSON.stringify([
      pairing({ companyAId: "b", companyBId: "a", score: 5 }),
      pairing({ companyAId: "a", companyBId: "c", score: 4 }),
    ]);
    const out = parseProactivePairings(raw, valid, excluded);
    expect(out.map((p) => pairKey(p.companyAId, p.companyBId))).toEqual([
      pairKey("a", "c"),
    ]);
  });

  it("de-duplicates a repeated pair, keeping the higher score", () => {
    const raw = JSON.stringify([
      pairing({ companyAId: "a", companyBId: "b", score: 3 }),
      pairing({ companyAId: "b", companyBId: "a", score: 5 }),
    ]);
    const out = parseProactivePairings(raw, valid, noExclusions);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(5);
  });

  it("clamps score and trims talking points to 3", () => {
    const raw = JSON.stringify([
      pairing({ score: 9, talkingPoints: ["1", " ", "2", "3", "4"] }),
    ]);
    const [p] = parseProactivePairings(raw, valid, noExclusions);
    expect(p.score).toBe(5);
    expect(p.talkingPoints).toEqual(["1", "2", "3"]);
  });

  it("returns [] for non-JSON or non-array input", () => {
    expect(parseProactivePairings("nope", valid, noExclusions)).toEqual([]);
    expect(parseProactivePairings("{}", valid, noExclusions)).toEqual([]);
  });
});
