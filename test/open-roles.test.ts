import { describe, it, expect } from "vitest";

import {
  DISCIPLINES,
  getDiscipline,
  openRoles,
  companyMatchesDiscipline,
} from "@/lib/disciplines";
import { parseRoleCandidates } from "@/lib/open-roles-engine";

// Unit test for the open-roles scan's PURE surface (slice 11.4c). No DB, no
// Anthropic call — guards the discipline vocabulary, the open-role detection used
// to render the picker, the keyword heuristic that seeds the candidate pool, and
// the defensive parser that rejects hallucinated or malformed model output. The AI
// call itself (generateRoleCandidates) is the single impure seam, exercised at
// runtime, not here.

describe("discipline vocabulary", () => {
  it("uses unique snake_case values with non-empty keyword lists", () => {
    const values = DISCIPLINES.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
    for (const d of DISCIPLINES) {
      expect(d.value).toMatch(/^[a-z_]+$/);
      expect(d.keywords.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known value and rejects a base participation role", () => {
    expect(getDiscipline("architect")?.label).toBe("Architect");
    // developer/site_host/agency/advisor are participation roles, not disciplines.
    expect(getDiscipline("developer")).toBeUndefined();
    expect(getDiscipline("nonsense")).toBeUndefined();
  });
});

describe("openRoles", () => {
  it("returns every discipline when nothing is staffed", () => {
    expect(openRoles([])).toHaveLength(DISCIPLINES.length);
  });

  it("excludes staffed disciplines and ignores non-discipline roles", () => {
    const out = openRoles(["architect", "lender", "developer"]);
    const values = out.map((d) => d.value);
    expect(values).not.toContain("architect");
    expect(values).not.toContain("lender");
    // `developer` isn't a discipline, so it removes nothing extra.
    expect(out).toHaveLength(DISCIPLINES.length - 2);
  });
});

describe("companyMatchesDiscipline", () => {
  const architect = getDiscipline("architect")!;
  const lender = getDiscipline("lender")!;

  it("matches on a keyword substring, case-insensitively", () => {
    expect(companyMatchesDiscipline(architect, "Boutique ARCHITECTURE studio")).toBe(
      true,
    );
    expect(companyMatchesDiscipline(lender, "regional bank and lending")).toBe(true);
  });

  it("does not match unrelated signals", () => {
    expect(companyMatchesDiscipline(architect, "hospitality operator")).toBe(false);
  });
});

describe("parseRoleCandidates", () => {
  const valid = new Set(["a", "b"]);

  it("parses a clean array, dropping hallucinated ids and sorting by score", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: 3, whyFit: "fits" },
      { companyId: "ghost", companyName: "Ghost", score: 5 },
      { companyId: "b", companyName: "B", score: 5, whyFit: "strong" },
    ]);
    const out = parseRoleCandidates(raw, valid);
    expect(out.map((c) => c.companyId)).toEqual(["b", "a"]);
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Sure:\n```json\n[{"companyId":"a","companyName":"A","score":4,"whyFit":"x"}]\n```\ndone';
    const out = parseRoleCandidates(raw, valid);
    expect(out).toHaveLength(1);
    expect(out[0].companyId).toBe("a");
  });

  it("clamps score into 3..5 and trims whyFit / concern", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: 9, whyFit: "  good  ", concern: " gap " },
    ]);
    const [c] = parseRoleCandidates(raw, valid);
    expect(c.score).toBe(5);
    expect(c.whyFit).toBe("good");
    expect(c.concern).toBe("gap");
  });

  it("floors a below-vocabulary score to the weakest real rung (3)", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: 1, whyFit: "x", concern: "" },
    ]);
    const [c] = parseRoleCandidates(raw, valid);
    expect(c.score).toBe(3);
  });

  it("drops entries with a non-finite score", () => {
    const raw = JSON.stringify([
      { companyId: "a", companyName: "A", score: "oops" },
    ]);
    expect(parseRoleCandidates(raw, valid)).toEqual([]);
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseRoleCandidates("not json", valid)).toEqual([]);
    expect(parseRoleCandidates("{}", valid)).toEqual([]);
    expect(parseRoleCandidates('{"companyId":"a"}', valid)).toEqual([]);
  });
});
