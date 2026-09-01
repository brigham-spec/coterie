import { describe, expect, test } from "vitest";

import {
  buildEnrichPrompt,
  parseProjectProposals,
  type EnrichArticle,
  type ProjectEnrichContext,
} from "@/lib/project-enrich";

// Pure-unit coverage for the project enrichment engine (no network). Proves the
// prompt carries the project's current fields + the numbered articles + the stage
// vocabulary, and that the parser is the trust boundary: it whitelists fields,
// coerces by kind (int / stage / bounded text), drops empties + echoes of the
// current value + out-of-vocab stages, and recovers only valid proposals.

const context: ProjectEnrichContext = {
  name: "Kingston Mill",
  stage: "pre_development",
  county: "Ulster",
  value: "5000000",
  units: "",
  sqft: "",
  prospectLead: "Rondout Partners",
  description: "Adaptive reuse of a historic mill.",
};

const articles: EnrichArticle[] = [
  { headline: "Groundbreaking held for Kingston Mill", summary: "Construction began Tuesday." },
  { headline: "Developer secures $12M in financing", summary: "" },
];

describe("buildEnrichPrompt", () => {
  test("includes the project name, current fields, and every article", () => {
    const prompt = buildEnrichPrompt(context, articles);
    expect(prompt).toContain("Kingston Mill");
    // Stage rendered as its human label, not the raw value.
    expect(prompt).toContain("Pre-Development");
    expect(prompt).toContain("County: Ulster");
    expect(prompt).toContain("Developer / lead: Rondout Partners");
    expect(prompt).toContain("1. Groundbreaking held for Kingston Mill");
    expect(prompt).toContain("2. Developer secures $12M in financing");
  });

  test("lists the full stage vocabulary the model may choose from", () => {
    const prompt = buildEnrichPrompt(context, articles);
    for (const value of [
      "concept",
      "pre_development",
      "under_construction",
      "completed",
      "on_hold",
    ]) {
      expect(prompt).toContain(value);
    }
  });

  test("renders an unknown stage when the project has no stage yet", () => {
    const prompt = buildEnrichPrompt(
      { name: "Blank", stage: "", county: "", value: "", units: "", sqft: "", prospectLead: "", description: "" },
      [{ headline: "Something happened", summary: "" }],
    );
    expect(prompt).toContain("Stage: unknown");
  });
});

describe("parseProjectProposals", () => {
  test("keeps whitelisted fields and coerces by kind", () => {
    const raw = JSON.stringify([
      { field: "stage", proposedValue: "under_construction", reason: "groundbreaking", confidence: "high" },
      { field: "value", proposedValue: "$12,000,000", reason: "financing", confidence: "medium" },
      { field: "units", proposedValue: "80", reason: "keys", confidence: "low" },
    ]);
    const out = parseProjectProposals(raw, context);
    expect(out).toEqual([
      {
        field: "stage",
        label: "Stage",
        currentValue: "pre_development",
        proposedValue: "under_construction",
        reason: "groundbreaking",
        confidence: "high",
      },
      {
        field: "value",
        label: "Value ($)",
        currentValue: "5000000",
        proposedValue: "12000000",
        reason: "financing",
        confidence: "medium",
      },
      {
        field: "units",
        label: "Units / keys",
        currentValue: "",
        proposedValue: "80",
        reason: "keys",
        confidence: "low",
      },
    ]);
  });

  test("drops unknown fields, out-of-vocab stages, empties, and echoes", () => {
    const raw = JSON.stringify([
      { field: "budget", proposedValue: "999", reason: "x", confidence: "high" },
      { field: "stage", proposedValue: "groundbreaking", reason: "x", confidence: "high" },
      { field: "county", proposedValue: "", reason: "x", confidence: "high" },
      // Echo of the current lead (case-insensitive) → dropped.
      { field: "prospectLead", proposedValue: "rondout partners", reason: "x", confidence: "high" },
      // Non-numeric int field → dropped.
      { field: "sqft", proposedValue: "lots", reason: "x", confidence: "high" },
    ]);
    expect(parseProjectProposals(raw, context)).toEqual([]);
  });

  test("dedupes repeated fields, keeping the first", () => {
    const raw = JSON.stringify([
      { field: "county", proposedValue: "Dutchess", reason: "first", confidence: "high" },
      { field: "county", proposedValue: "Orange", reason: "second", confidence: "low" },
    ]);
    const out = parseProjectProposals(raw, context);
    expect(out).toHaveLength(1);
    expect(out[0].proposedValue).toBe("Dutchess");
  });

  test("defaults an unrecognized confidence to medium", () => {
    const raw = JSON.stringify([
      { field: "county", proposedValue: "Dutchess", reason: "x", confidence: "certain" },
    ]);
    expect(parseProjectProposals(raw, context)[0].confidence).toBe("medium");
  });

  test("returns [] for non-array / non-JSON input", () => {
    expect(parseProjectProposals("not json at all", context)).toEqual([]);
    expect(parseProjectProposals(JSON.stringify({ field: "county" }), context)).toEqual([]);
  });
});
