import { describe, it, expect } from "vitest";

import { parseNetworkMatches } from "@/lib/network-search";

// Unit test for the network-search PURE surface (slice 11.5). No DB, no Anthropic
// call — guards the defensive parser that turns the model's JSON into ranked
// matches: it must drop hallucinated company ids, clamp relevance, trim strings,
// sort by relevance, cap the list, and survive non-JSON / non-array output. The
// AI call itself (generateNetworkMatches) is the impure seam, exercised at runtime.

describe("parseNetworkMatches", () => {
  const valid = new Set(["a", "b", "c"]);

  it("parses a clean array, dropping hallucinated ids and sorting by relevance", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", relevance: 3, why: "fits" },
      { companyId: "ghost", companyName: "Ghost", relevance: 5 },
      { companyId: "b", companyName: "B", relevance: 5, why: "strong" },
    ]);
    const out = parseNetworkMatches(raw, valid);
    expect(out.map((m) => m.companyId)).toEqual(["b", "a"]);
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Here you go:\n```json\n[{"companyId":"a","companyName":"A","relevance":4,"why":"x"}]\n```\ndone';
    const out = parseNetworkMatches(raw, valid);
    expect(out).toHaveLength(1);
    expect(out[0].companyId).toBe("a");
  });

  it("clamps relevance into 1..5 and trims text fields", () => {
    const raw = JSON.stringify([
      {
        companyId: "a",
        companyName: "  A  ",
        contactName: " Jane ",
        why: "  good  ",
        relevance: 9,
        keyDetail: " detail ",
      },
    ]);
    const [m] = parseNetworkMatches(raw, valid);
    expect(m.relevance).toBe(5);
    expect(m.companyName).toBe("A");
    expect(m.contactName).toBe("Jane");
    expect(m.why).toBe("good");
    expect(m.keyDetail).toBe("detail");
  });

  it("drops entries with a non-finite relevance", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", relevance: "oops" },
    ]);
    expect(parseNetworkMatches(raw, valid)).toEqual([]);
  });

  it("caps the result at 8 matches", () => {
    const raw = JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({
        companyId: "a",
        companyName: `A${i}`,
        relevance: 5,
      })),
    );
    expect(parseNetworkMatches(raw, valid)).toHaveLength(8);
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseNetworkMatches("not json", valid)).toEqual([]);
    expect(parseNetworkMatches("{}", valid)).toEqual([]);
    expect(parseNetworkMatches('{"companyId":"a"}', valid)).toEqual([]);
  });
});
