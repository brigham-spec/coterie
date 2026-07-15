import { describe, expect, test } from "vitest";

import {
  buildEnrichWebPrompt,
  parseWebEnrichment,
  type EnrichWebContext,
} from "@/lib/enrich-web";

// Unit coverage for the pure enrich-from-web helpers. Asserts the parser pulls a
// JSON object out of fenced / prose-wrapped output (web-search replies are
// chatty), coerces every field to a bounded string, treats the literal "null" and
// a mere echo of the current industry as empty, and signals failure (null) when
// every writable field is empty; and that the prompt embeds the current field
// values, the URLs-to-research block, and the exact JSON shape we consume.

const CURRENT_INDUSTRY = "Manufacturing";

const full = JSON.stringify({
  summary: "Public filings show a Series B raise and a new Kingston site.",
  lookingFor: "growth capital and a land-use attorney for a Catskill site",
  canOffer: "contract manufacturing capacity and supplier relationships",
  industry: "Advanced Manufacturing",
  counties: "Ulster, Dutchess",
  dealSize: "$5M-$20M",
  agencyContacts: "Ulster County IDA",
  notesAppend: "Announced a Series B raise; targeting a Q4 site decision.",
});

describe("parseWebEnrichment", () => {
  test("extracts every field from a clean JSON object", () => {
    const e = parseWebEnrichment(full, CURRENT_INDUSTRY);
    expect(e).not.toBeNull();
    expect(e).toEqual({
      summary: "Public filings show a Series B raise and a new Kingston site.",
      lookingFor: "growth capital and a land-use attorney for a Catskill site",
      canOffer: "contract manufacturing capacity and supplier relationships",
      industry: "Advanced Manufacturing",
      counties: "Ulster, Dutchess",
      dealSize: "$5M-$20M",
      agencyContacts: "Ulster County IDA",
      notesAppend: "Announced a Series B raise; targeting a Q4 site decision.",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Here is what I found:\n```json\n" + full + "\n```\nDone.";
    const e = parseWebEnrichment(raw, CURRENT_INDUSTRY);
    expect(e).not.toBeNull();
    expect(e!.counties).toBe("Ulster, Dutchess");
  });

  test("clears an industry that merely echoes the current one (case-insensitive)", () => {
    const e = parseWebEnrichment(
      JSON.stringify({ counties: "Ulster", industry: "manufacturing" }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.industry).toBe("");
    expect(e!.counties).toBe("Ulster");
  });

  test("treats the literal string \"null\" as empty", () => {
    const e = parseWebEnrichment(
      JSON.stringify({ dealSize: "null", agencyContacts: "Empire State Development", counties: "null" }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.dealSize).toBe("");
    expect(e!.counties).toBe("");
    expect(e!.agencyContacts).toBe("Empire State Development");
  });

  test("coerces non-string fields to empty strings", () => {
    const e = parseWebEnrichment(
      JSON.stringify({ agencyContacts: "IDA", dealSize: 42, counties: null }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.dealSize).toBe("");
    expect(e!.counties).toBe("");
    expect(e!.agencyContacts).toBe("IDA");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseWebEnrichment("no json here", CURRENT_INDUSTRY)).toBeNull();
    expect(parseWebEnrichment("", CURRENT_INDUSTRY)).toBeNull();
  });

  test("returns null when every writable field is empty", () => {
    // A summary alone (display-only) is not enough — nothing writable came back.
    const e = parseWebEnrichment(
      JSON.stringify({ summary: "a recap", industry: "manufacturing" }),
      CURRENT_INDUSTRY,
    );
    expect(e).toBeNull();
  });

  test("keeps an enrichment with only counties", () => {
    const e = parseWebEnrichment(
      JSON.stringify({ counties: "Orange, Sullivan" }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.counties).toBe("Orange, Sullivan");
    expect(e!.lookingFor).toBe("");
  });
});

describe("buildEnrichWebPrompt", () => {
  const context: EnrichWebContext = {
    orgName: "Acme Mills",
    companyName: "Acme Mills",
    contactName: "Jane Doe",
    industry: "Manufacturing",
    counties: ["Ulster"],
    website: "https://acmemills.example",
    lookingFor: "site selection help",
    canOffer: "",
    dealSize: "",
    agencyContacts: "",
  };

  test("embeds the current field values, the research URL, and the JSON shape", () => {
    const prompt = buildEnrichWebPrompt(context);
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Primary Contact: Jane Doe");
    expect(prompt).toContain("Counties: Ulster");
    expect(prompt).toContain("Looking For: site selection help");
    // Empty current fields are simply omitted from the known-profile block.
    expect(prompt).not.toContain("Can Offer:");
    expect(prompt).toContain("Organization website: https://acmemills.example");
    // The exact JSON shape we consume is requested.
    expect(prompt).toContain('"agencyContacts"');
    expect(prompt).toContain('"notesAppend"');
  });

  test("falls back to a name search when no website is set", () => {
    const prompt = buildEnrichWebPrompt({ ...context, website: null });
    expect(prompt).not.toContain("Organization website:");
    expect(prompt).toContain('Search for "Acme Mills"');
  });
});
