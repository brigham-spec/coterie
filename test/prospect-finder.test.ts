import { describe, it, expect } from "vitest";

import { parseProspectTargets } from "@/lib/prospect-finder";

// Unit test for the prospect-finder PURE surface (slice 11.6). No web search, no
// Anthropic call — guards the defensive parser that turns a chatty web-search
// reply into scored external prospects: it must survive prose/fences, drop
// entries with no org name, drop orgs already in the network (case-insensitive),
// default a garbled score rather than discard a real find, coerce the website,
// sort by score, and cap the list. The web_search call itself is the impure seam.

describe("parseProspectTargets", () => {
  it("parses a clean array and sorts by score (desc)", () => {
    const raw = JSON.stringify([
      { org: "Alpha Dev", score: 3 },
      { org: "Beta Capital", score: 5 },
      { org: "Gamma Legal", score: 4 },
    ]);
    const out = parseProspectTargets(raw);
    expect(out.map((t) => t.org)).toEqual(["Beta Capital", "Gamma Legal", "Alpha Dev"]);
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Here are prospects I found:\n```json\n[{"org":"Riverside Builders","score":4}]\n```\nHope that helps!';
    const out = parseProspectTargets(raw);
    expect(out).toHaveLength(1);
    expect(out[0].org).toBe("Riverside Builders");
  });

  it("drops entries with no org name", () => {
    const raw = JSON.stringify([
      { org: "", score: 5 },
      { contact: "No Org Person", score: 5 },
      { org: "Real Firm", score: 3 },
    ]);
    const out = parseProspectTargets(raw);
    expect(out.map((t) => t.org)).toEqual(["Real Firm"]);
  });

  it("drops orgs already in the network, case-insensitively", () => {
    const raw = JSON.stringify([
      { org: "Existing Member LLC", score: 5 },
      { org: "Fresh Prospect", score: 4 },
    ]);
    const out = parseProspectTargets(raw, ["  existing member llc  ", "Other Co"]);
    expect(out.map((t) => t.org)).toEqual(["Fresh Prospect"]);
  });

  it("defaults a missing/garbled score to 3 and clamps into 1..5", () => {
    const raw = JSON.stringify([
      { org: "NoScore Co" },
      { org: "BadScore Co", score: "oops" },
      { org: "Over Co", score: 9 },
    ]);
    const out = parseProspectTargets(raw);
    const byOrg = Object.fromEntries(out.map((t) => [t.org, t.score]));
    expect(byOrg["NoScore Co"]).toBe(3);
    expect(byOrg["BadScore Co"]).toBe(3);
    expect(byOrg["Over Co"]).toBe(5);
  });

  it("keeps only http(s) websites, nulling anything else", () => {
    const raw = JSON.stringify([
      { org: "A", website: "https://a.example", score: 3 },
      { org: "B", website: "null", score: 3 },
      { org: "C", website: "just text", score: 3 },
    ]);
    const byOrg = Object.fromEntries(
      parseProspectTargets(raw).map((t) => [t.org, t.website]),
    );
    expect(byOrg["A"]).toBe("https://a.example");
    expect(byOrg["B"]).toBeNull();
    expect(byOrg["C"]).toBeNull();
  });

  it("caps the result at 10 and trims text fields", () => {
    const many = JSON.stringify(
      Array.from({ length: 14 }, (_, i) => ({ org: `Org ${i}`, score: 5 })),
    );
    expect(parseProspectTargets(many)).toHaveLength(10);

    const [t] = parseProspectTargets(
      JSON.stringify([{ org: "  Spaced Co  ", why: "  strong fit  ", score: 4 }]),
    );
    expect(t.org).toBe("Spaced Co");
    expect(t.why).toBe("strong fit");
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseProspectTargets("not json")).toEqual([]);
    expect(parseProspectTargets("{}")).toEqual([]);
    expect(parseProspectTargets('{"org":"x"}')).toEqual([]);
  });
});
