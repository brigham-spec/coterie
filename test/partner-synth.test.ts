import { describe, expect, test } from "vitest";

import {
  buildPartnerSynthPrompt,
  parsePartnerSynthesis,
  type PartnerSynthInput,
} from "@/lib/partner-synth";

// Pure parse/prompt tests for the partner-synthesis engine. The model returns a
// JSON object with category/summary/relevanceToHVEDC/suggestedCollaboration; the
// parser folds the two prose fields into one Partnership Summary, bounds every
// field, and returns null when nothing usable came back.

function input(over: Partial<PartnerSynthInput> = {}): PartnerSynthInput {
  return {
    orgName: "HVEDC",
    companyName: "State Ag",
    contactName: "",
    relationship: "",
    website: "",
    ...over,
  };
}

describe("parsePartnerSynthesis", () => {
  test("folds summary + relevance into one block and keeps category/collaboration", () => {
    const s = parsePartnerSynthesis(
      JSON.stringify({
        category: "Government Agency",
        summary: "They run the state grant program.",
        relevanceToHVEDC: "They control funding our members need.",
        suggestedCollaboration: "Co-host a grant workshop.",
      }),
    );
    expect(s).toEqual({
      category: "Government Agency",
      summary:
        "They run the state grant program.\n\nThey control funding our members need.",
      collaboration: "Co-host a grant workshop.",
    });
  });

  test("pulls the JSON object out of prose / code fences", () => {
    const s = parsePartnerSynthesis(
      'Here is what I found:\n```json\n{"category":"Utility","summary":"Power provider."}\n```',
    );
    expect(s?.category).toBe("Utility");
    expect(s?.summary).toBe("Power provider.");
    expect(s?.collaboration).toBe("");
  });

  test("summary alone (no relevance) is still kept", () => {
    const s = parsePartnerSynthesis(
      JSON.stringify({ summary: "Just a description." }),
    );
    expect(s?.summary).toBe("Just a description.");
  });

  test("treats the literal string \"null\" as empty", () => {
    const s = parsePartnerSynthesis(
      JSON.stringify({
        category: "null",
        summary: "Real summary.",
        suggestedCollaboration: "null",
      }),
    );
    expect(s).toEqual({ category: "", summary: "Real summary.", collaboration: "" });
  });

  test("returns null when every field is empty", () => {
    expect(
      parsePartnerSynthesis(
        JSON.stringify({ category: "", summary: "", suggestedCollaboration: "" }),
      ),
    ).toBeNull();
  });

  test("returns null on non-JSON", () => {
    expect(parsePartnerSynthesis("I could not find anything.")).toBeNull();
  });
});

describe("buildPartnerSynthPrompt", () => {
  test("embeds the partner context and asks for the exact JSON keys", () => {
    const p = buildPartnerSynthPrompt(
      input({
        companyName: "Empire Bank",
        contactName: "Jane Roe",
        relationship: "Regional lending partner",
        website: "https://empire.example",
      }),
    );
    expect(p).toContain("HVEDC");
    expect(p).toContain("Empire Bank");
    expect(p).toContain("Jane Roe");
    expect(p).toContain("Regional lending partner");
    expect(p).toContain("https://empire.example");
    expect(p).toContain("suggestedCollaboration");
  });

  test("marks missing hints as not provided", () => {
    const p = buildPartnerSynthPrompt(input());
    expect(p).toContain("Relationship: (not provided)");
    expect(p).toContain("Website: (not provided)");
    expect(p).toContain("Contact: (unknown)");
  });
});
