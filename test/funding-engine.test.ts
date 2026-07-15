import { describe, expect, test } from "vitest";

import {
  buildFundingPrompt,
  parseFundingSuggestions,
  type FundingProjectContext,
} from "@/lib/funding-engine";

// Unit tests for the funding engine's PURE seams: parsing the model's JSON array
// into validated suggestions, and building the eligibility-gated prompt (strict
// vs. exploratory mode + regional-program injection). The network call itself is
// exercised only through the action integration test.

function ctx(over: Partial<FundingProjectContext> = {}): FundingProjectContext {
  return {
    name: "Riverfront Lofts",
    type: null,
    stage: null,
    county: null,
    industry: null,
    value: null,
    units: null,
    description: null,
    ...over,
  };
}

describe("parseFundingSuggestions", () => {
  test("parses a fenced JSON array and normalizes fields", () => {
    const raw =
      "Here you go:\n```json\n" +
      JSON.stringify([
        {
          name: "Restore NY",
          agency: "ESD",
          category: "Grant",
          estimatedBenefit: "Up to $2M",
          rationale: "Vacant industrial building conversion.",
          action: "Ask the city to sponsor.",
        },
      ]) +
      "\n```";
    const out = parseFundingSuggestions(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "Restore NY",
      agency: "ESD",
      category: "Grant",
      estimatedBenefit: "Up to $2M",
    });
  });

  test("drops entries with no name and folds an out-of-vocab category to Grant", () => {
    const raw = JSON.stringify([
      { name: "", category: "Grant" },
      { name: "Mystery Fund", category: "Subsidy" },
    ]);
    const out = parseFundingSuggestions(raw);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Mystery Fund");
    expect(out[0].category).toBe("Grant");
  });

  test("returns [] for non-JSON or a non-array payload", () => {
    expect(parseFundingSuggestions("no json here")).toEqual([]);
    expect(parseFundingSuggestions('{"name":"x"}')).toEqual([]);
  });
});

describe("buildFundingPrompt", () => {
  test("always embeds the eligibility gates", () => {
    const prompt = buildFundingPrompt(ctx());
    expect(prompt).toContain("CRITICAL ELIGIBILITY RULES");
    expect(prompt).toContain("9% LIHTC");
  });

  test("uses strict mode when the context is rich", () => {
    const prompt = buildFundingPrompt(
      ctx({ description: "80-unit affordable rental targeting 50% AMI", units: 80 }),
    );
    expect(prompt).toContain("ACTUALLY QUALIFIES FOR");
    expect(prompt).not.toContain("This project has limited details");
  });

  test("uses exploratory mode when the context is sparse", () => {
    const prompt = buildFundingPrompt(ctx({ name: "Unnamed lot" }));
    expect(prompt).toContain("This project has limited details");
  });

  test("injects the county's known regional programs", () => {
    const prompt = buildFundingPrompt(ctx({ county: "Ulster" }));
    expect(prompt).toContain("KNOWN LOCAL PROGRAMS for Ulster County");
    expect(prompt).toContain("Ulster County Housing Action Fund (HAF)");
    expect(prompt).toContain("Developer applies directly");
  });

  test("omits the regional block when the county is blank", () => {
    const prompt = buildFundingPrompt(ctx({ county: null }));
    expect(prompt).not.toContain("KNOWN LOCAL PROGRAMS");
  });
});
