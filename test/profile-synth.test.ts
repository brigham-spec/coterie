import { describe, expect, test } from "vitest";

import {
  buildSynthPrompt,
  parseProfileSynthesis,
  type SynthCompanyContext,
  type SynthEvidence,
} from "@/lib/profile-synth";

// Unit coverage for the pure batch-profile-synth helpers. Asserts the parser
// pulls a JSON object out of fenced / prose-wrapped output, coerces every field
// to a bounded string, treats the literal "null" and a mere echo of a current
// value as empty, proposes only NEW counties (dropping ones already on record),
// and signals failure (null) when every writable field is empty; and that the
// prompt embeds the current field values plus each non-empty evidence section.

const current: SynthCompanyContext = {
  name: "Acme Mills",
  contactName: "Jane Doe",
  industry: "Manufacturing",
  status: "member",
  lookingFor: "growth capital",
  canOffer: "",
  counties: ["Dutchess", "Ulster"],
  agencyContacts: "",
  dealSize: "",
  notes: "Long-standing member.",
};

const full = JSON.stringify({
  summary: "They are scaling and need capital plus land-use help.",
  lookingFor: "growth capital and a land-use attorney",
  canOffer: "contract manufacturing capacity",
  counties: "Dutchess, Orange, Greene",
  agencyContacts: "Ulster County IDA",
  dealSize: "$2-5M",
  notesAppend: "per [2026-06-01] meeting: board approved a Series B raise.",
});

describe("parseProfileSynthesis", () => {
  test("extracts every field from a clean JSON object", () => {
    const s = parseProfileSynthesis(full, current);
    expect(s).not.toBeNull();
    expect(s).toEqual({
      summary: "They are scaling and need capital plus land-use help.",
      lookingFor: "growth capital and a land-use attorney",
      canOffer: "contract manufacturing capacity",
      // Dutchess is already on record → dropped; only the new counties remain.
      counties: "Orange, Greene",
      agencyContacts: "Ulster County IDA",
      dealSize: "$2-5M",
      notesAppend: "per [2026-06-01] meeting: board approved a Series B raise.",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Sure:\n```json\n" + full + "\n```\nDone.";
    const s = parseProfileSynthesis(raw, current);
    expect(s).not.toBeNull();
    expect(s!.canOffer).toContain("contract manufacturing");
  });

  test("proposes only counties not already on record (case-insensitive)", () => {
    const s = parseProfileSynthesis(
      JSON.stringify({ counties: "dutchess, ULSTER, Columbia" }),
      current,
    );
    expect(s).not.toBeNull();
    expect(s!.counties).toBe("Columbia");
  });

  test("clears a field that merely echoes the current value (case-insensitive)", () => {
    const s = parseProfileSynthesis(
      JSON.stringify({ lookingFor: "GROWTH CAPITAL", canOffer: "new capability" }),
      current,
    );
    expect(s).not.toBeNull();
    expect(s!.lookingFor).toBe("");
    expect(s!.canOffer).toBe("new capability");
  });

  test('treats the literal string "null" as empty', () => {
    const s = parseProfileSynthesis(
      JSON.stringify({ canOffer: "null", dealSize: "$1M", notesAppend: "null" }),
      current,
    );
    expect(s).not.toBeNull();
    expect(s!.canOffer).toBe("");
    expect(s!.notesAppend).toBe("");
    expect(s!.dealSize).toBe("$1M");
  });

  test("coerces non-string fields to empty strings", () => {
    const s = parseProfileSynthesis(
      JSON.stringify({ canOffer: "capacity", dealSize: 42, agencyContacts: null }),
      current,
    );
    expect(s).not.toBeNull();
    expect(s!.dealSize).toBe("");
    expect(s!.agencyContacts).toBe("");
    expect(s!.canOffer).toBe("capacity");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseProfileSynthesis("no json here", current)).toBeNull();
    expect(parseProfileSynthesis("", current)).toBeNull();
  });

  test("returns null when every writable field is empty", () => {
    // A summary is display-only, and every proposed county is already on record —
    // nothing writable came back.
    const s = parseProfileSynthesis(
      JSON.stringify({ summary: "a recap", counties: "Dutchess, Ulster" }),
      current,
    );
    expect(s).toBeNull();
  });

  test("keeps a synthesis with only a notes append", () => {
    const s = parseProfileSynthesis(
      JSON.stringify({ notesAppend: "New strategic context worth recording." }),
      current,
    );
    expect(s).not.toBeNull();
    expect(s!.notesAppend).toBe("New strategic context worth recording.");
    expect(s!.lookingFor).toBe("");
  });
});

describe("buildSynthPrompt", () => {
  const evidence: SynthEvidence = {
    meetings: [
      {
        date: "2026-06-01",
        title: "Q3 check-in",
        summary: "Discussed the IDA application and a possible Series B.",
      },
    ],
    eventNotes: ["Spring Mixer: chatted about the Kingston mill expansion."],
    intros: ["Intro to Bob Vance → warm handoff, meeting set"],
    openItems: ["Send the IDA draft"],
    doneItems: ["Shared the site plan"],
    articles: ["Acme lands state grant — $500k awarded for the mill."],
    projects: ["Kingston Mill Redevelopment (Due Diligence)"],
  };

  test("embeds the current field values and each non-empty evidence section", () => {
    const prompt = buildSynthPrompt(current, evidence);
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Looking For: growth capital");
    expect(prompt).toContain("Counties: Dutchess, Ulster");
    expect(prompt).toContain("MEETING HISTORY");
    expect(prompt).toContain("[2026-06-01] Q3 check-in");
    expect(prompt).toContain("EVENT CONVERSATION NOTES");
    expect(prompt).toContain("INTRODUCTIONS MADE");
    expect(prompt).toContain("OPEN COMMITMENTS");
    expect(prompt).toContain("COMPLETED COMMITMENTS");
    expect(prompt).toContain("SAVED ARTICLES");
    expect(prompt).toContain("ACTIVE PROJECTS");
    // The exact JSON shape we consume is requested.
    expect(prompt).toContain('"agencyContacts"');
    expect(prompt).toContain('"dealSize"');
  });

  test("omits evidence sections that are empty", () => {
    const prompt = buildSynthPrompt(current, {
      meetings: evidence.meetings,
      eventNotes: [],
      intros: [],
      openItems: [],
      doneItems: [],
      articles: [],
      projects: [],
    });
    expect(prompt).toContain("MEETING HISTORY");
    expect(prompt).not.toContain("EVENT CONVERSATION NOTES");
    expect(prompt).not.toContain("INTRODUCTIONS MADE");
    expect(prompt).not.toContain("ACTIVE PROJECTS");
  });
});
