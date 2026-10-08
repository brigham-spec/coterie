import { describe, it, expect } from "vitest";

import {
  buildSecondaryProfilePrompt,
  parseSecondaryProfile,
  type SecondaryProfileContext,
} from "@/lib/secondary-profile";

// Pure parse/bound tests for the secondary-profile engine. Guards the JSON
// extraction, the literal-"null" scrub, the over-length trim, the empty→null
// collapse, and that the prompt actually carries the affiliations + documents.

describe("parseSecondaryProfile", () => {
  it("parses a valid JSON object into the triplet", () => {
    const out = parseSecondaryProfile(
      '{"secondaryIndustry":"Logistics, Warehousing","secondaryCanOffer":"Fleet capacity","secondaryLookingFor":"Cold-storage partners"}',
    );
    expect(out).toEqual({
      secondaryIndustry: "Logistics, Warehousing",
      secondaryCanOffer: "Fleet capacity",
      secondaryLookingFor: "Cold-storage partners",
    });
  });

  it("extracts the object from surrounding prose / fences", () => {
    const out = parseSecondaryProfile(
      'Here is the result:\n```json\n{"secondaryIndustry":"Real estate","secondaryCanOffer":"","secondaryLookingFor":""}\n```',
    );
    expect(out).toEqual({
      secondaryIndustry: "Real estate",
      secondaryCanOffer: "",
      secondaryLookingFor: "",
    });
  });

  it("returns null when every field is empty", () => {
    expect(
      parseSecondaryProfile(
        '{"secondaryIndustry":"","secondaryCanOffer":"","secondaryLookingFor":""}',
      ),
    ).toBeNull();
  });

  it("scrubs the literal string 'null' to empty (and so can collapse to null)", () => {
    expect(
      parseSecondaryProfile(
        '{"secondaryIndustry":"null","secondaryCanOffer":"NULL","secondaryLookingFor":"null"}',
      ),
    ).toBeNull();
  });

  it("trims over-length fields to their caps", () => {
    const long = "x".repeat(500);
    const out = parseSecondaryProfile(
      JSON.stringify({
        secondaryIndustry: long,
        secondaryCanOffer: long,
        secondaryLookingFor: "",
      }),
    );
    expect(out!.secondaryIndustry).toHaveLength(120);
    expect(out!.secondaryCanOffer).toHaveLength(300);
  });

  it("returns null on non-JSON", () => {
    expect(parseSecondaryProfile("no json here")).toBeNull();
  });
});

describe("buildSecondaryProfilePrompt", () => {
  const context: SecondaryProfileContext = {
    orgName: "HVEDC",
    companyName: "Acme Mills",
    primaryIndustry: "Manufacturing",
    primaryLookingFor: "Capital",
    primaryCanOffer: "Precision machining",
    affiliations: [
      {
        name: "Acme Logistics",
        role: "Founder",
        industry: "Transportation",
        canOffer: "Fleet capacity",
        lookingFor: "Warehouse partners",
      },
    ],
    documentSummaries: ["A pitch deck for a new cold-storage venture."],
  };

  it("carries the primary profile, affiliations, and document summaries", () => {
    const prompt = buildSecondaryProfilePrompt(context);
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Manufacturing");
    expect(prompt).toContain("Acme Logistics");
    expect(prompt).toContain("Fleet capacity");
    expect(prompt).toContain("cold-storage venture");
  });

  it("marks empty affiliation/document sets rather than omitting them", () => {
    const prompt = buildSecondaryProfilePrompt({
      ...context,
      affiliations: [],
      documentSummaries: [],
    });
    expect(prompt).toContain("(none on file)");
  });
});
