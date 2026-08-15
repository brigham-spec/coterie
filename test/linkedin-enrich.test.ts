import { describe, expect, test } from "vitest";

import { parseLinkedinEnrichments } from "@/lib/linkedin-enrich";

// Pure tests for parseLinkedinEnrichments — the integrity-critical seam between the
// model's free-text JSON and what we're willing to write. The load-bearing rules:
// an entry is matched back to a supplied row by ref (unknown/duplicate refs are
// dropped so a hallucination can't land on the wrong person); a null/""/"null"
// value is read as "no basis" with null confidence; a present value with a
// missing/garbled grade degrades to "low" (uncertainty is never rounded up); and
// non-JSON / non-array garbage yields [] rather than throwing.

const refs = (...ids: string[]) => new Set(ids);

describe("parseLinkedinEnrichments", () => {
  test("maps a valid array back to its refs", () => {
    const raw = JSON.stringify([
      {
        ref: "0",
        industry: "Commercial Real Estate",
        industryConfidence: "high",
        seniority: "Director",
        seniorityConfidence: "low",
        jobFunction: "Sales",
        jobFunctionConfidence: "high",
      },
    ]);
    expect(parseLinkedinEnrichments(raw, refs("0"))).toEqual([
      {
        ref: "0",
        industry: "Commercial Real Estate",
        industryConfidence: "high",
        seniority: "Director",
        seniorityConfidence: "low",
        jobFunction: "Sales",
        jobFunctionConfidence: "high",
      },
    ]);
  });

  test("drops an entry whose ref was never sent", () => {
    const raw = JSON.stringify([
      { ref: "99", industry: "Healthcare", industryConfidence: "high" },
    ]);
    expect(parseLinkedinEnrichments(raw, refs("0"))).toEqual([]);
  });

  test("keeps the first of a duplicated ref", () => {
    const raw = JSON.stringify([
      { ref: "0", industry: "Finance", industryConfidence: "high" },
      { ref: "0", industry: "Software", industryConfidence: "low" },
    ]);
    const out = parseLinkedinEnrichments(raw, refs("0"));
    expect(out).toHaveLength(1);
    expect(out[0].industry).toBe("Finance");
    expect(out[0].industryConfidence).toBe("high");
  });

  test("reads null / \"\" / \"null\" as no basis, with null confidence", () => {
    const raw = JSON.stringify([
      {
        ref: "0",
        industry: null,
        industryConfidence: "high",
        seniority: "",
        seniorityConfidence: "high",
        jobFunction: "null",
        jobFunctionConfidence: "high",
      },
    ]);
    expect(parseLinkedinEnrichments(raw, refs("0"))).toEqual([
      {
        ref: "0",
        industry: null,
        industryConfidence: null,
        seniority: null,
        seniorityConfidence: null,
        jobFunction: null,
        jobFunctionConfidence: null,
      },
    ]);
  });

  test("degrades a present value with a missing/garbled grade to low", () => {
    const raw = JSON.stringify([
      {
        ref: "0",
        industry: "Manufacturing", // no confidence supplied
        seniority: "VP",
        seniorityConfidence: "medium", // not "high"
      },
    ]);
    const out = parseLinkedinEnrichments(raw, refs("0"));
    expect(out[0].industryConfidence).toBe("low");
    expect(out[0].seniorityConfidence).toBe("low");
  });

  test("coerces a numeric ref to a string before matching", () => {
    const raw = JSON.stringify([
      { ref: 0, industry: "Legal", industryConfidence: "high" },
    ]);
    const out = parseLinkedinEnrichments(raw, refs("0"));
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("0");
  });

  test("returns [] for non-JSON and for a non-array payload", () => {
    expect(parseLinkedinEnrichments("not json at all", refs("0"))).toEqual([]);
    expect(parseLinkedinEnrichments(JSON.stringify({ ref: "0" }), refs("0"))).toEqual(
      [],
    );
  });

  test("tolerates prose/fences around the array", () => {
    const raw =
      "Here you go:\n```json\n" +
      JSON.stringify([{ ref: "0", industry: "Design", industryConfidence: "low" }]) +
      "\n```";
    const out = parseLinkedinEnrichments(raw, refs("0"));
    expect(out).toHaveLength(1);
    expect(out[0].industry).toBe("Design");
  });
});
