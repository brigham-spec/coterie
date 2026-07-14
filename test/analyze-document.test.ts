import { describe, expect, test } from "vitest";

import {
  buildDocumentPrompt,
  parseDocumentIntel,
  type DocumentCompanyContext,
} from "@/lib/analyze-document";

// Unit coverage for the pure analyze-document helpers. Asserts the parser pulls a
// JSON object out of fenced / prose-wrapped output, coerces every field to a
// bounded string, treats the literal "null" as empty, and signals failure (null)
// when every writable field is empty (a docSummary alone is display-only); and
// that the prompt embeds the member's current field values and the file name.

const full = JSON.stringify({
  docSummary: "A Series B offering memo for a Kingston manufacturing site.",
  lookingFor: "$8M growth capital, closing Q4",
  canOffer: "12% target IRR, contract manufacturing capacity",
  counties: "Ulster, Dutchess",
  dealSize: "$5M–$10M",
  agencyContacts: "Ulster County IDA",
  notesAppend: "Board approved the raise; targeting a Q4 site decision.",
});

describe("parseDocumentIntel", () => {
  test("extracts every field from a clean JSON object", () => {
    const intel = parseDocumentIntel(full);
    expect(intel).not.toBeNull();
    expect(intel).toEqual({
      docSummary: "A Series B offering memo for a Kingston manufacturing site.",
      lookingFor: "$8M growth capital, closing Q4",
      canOffer: "12% target IRR, contract manufacturing capacity",
      counties: "Ulster, Dutchess",
      dealSize: "$5M–$10M",
      agencyContacts: "Ulster County IDA",
      notesAppend: "Board approved the raise; targeting a Q4 site decision.",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Here you go:\n```json\n" + full + "\n```\nDone.";
    const intel = parseDocumentIntel(raw);
    expect(intel).not.toBeNull();
    expect(intel!.dealSize).toBe("$5M–$10M");
  });

  test('treats the literal string "null" as empty', () => {
    const intel = parseDocumentIntel(
      JSON.stringify({ lookingFor: "null", canOffer: "real capacity", dealSize: "null" }),
    );
    expect(intel).not.toBeNull();
    expect(intel!.lookingFor).toBe("");
    expect(intel!.dealSize).toBe("");
    expect(intel!.canOffer).toBe("real capacity");
  });

  test("coerces non-string fields to empty strings", () => {
    const intel = parseDocumentIntel(
      JSON.stringify({ canOffer: "capacity", lookingFor: 42, agencyContacts: null }),
    );
    expect(intel).not.toBeNull();
    expect(intel!.lookingFor).toBe("");
    expect(intel!.agencyContacts).toBe("");
    expect(intel!.canOffer).toBe("capacity");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseDocumentIntel("no json here")).toBeNull();
    expect(parseDocumentIntel("")).toBeNull();
  });

  test("returns null when only a docSummary came back (nothing writable)", () => {
    const intel = parseDocumentIntel(
      JSON.stringify({ docSummary: "A one-page teaser with no specifics." }),
    );
    expect(intel).toBeNull();
  });

  test("keeps intel with only a notes append", () => {
    const intel = parseDocumentIntel(
      JSON.stringify({ notesAppend: "Key term: 8% preferred return." }),
    );
    expect(intel).not.toBeNull();
    expect(intel!.notesAppend).toBe("Key term: 8% preferred return.");
    expect(intel!.lookingFor).toBe("");
  });
});

describe("buildDocumentPrompt", () => {
  const context: DocumentCompanyContext = {
    fileName: "acme-offering-memo.pdf",
    orgName: "Acme Mills",
    contactName: "Jane Doe",
    industry: "Manufacturing",
    lookingFor: "site selection help",
    canOffer: "",
    counties: "Ulster",
    dealSize: "",
    agencyContacts: "",
  };

  test("embeds the member's current field values and the file name", () => {
    const prompt = buildDocumentPrompt(context);
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Primary Contact: Jane Doe");
    expect(prompt).toContain("Document: acme-offering-memo.pdf");
    expect(prompt).toContain("Current — Looking For: site selection help");
    // An empty current field shows a placeholder, not a blank.
    expect(prompt).toContain("Current — Can Offer: (empty)");
    expect(prompt).toContain("Current — Counties: Ulster");
    // The exact JSON shape we consume is requested.
    expect(prompt).toContain('"docSummary"');
    expect(prompt).toContain('"agencyContacts"');
  });

  test("omits the primary-contact line when there is no contact", () => {
    const prompt = buildDocumentPrompt({ ...context, contactName: "" });
    expect(prompt).not.toContain("Primary Contact:");
  });
});
