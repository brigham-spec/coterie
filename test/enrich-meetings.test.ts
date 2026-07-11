import { describe, expect, test } from "vitest";

import {
  buildEnrichMeetingsPrompt,
  parseProfileEnrichment,
  type EnrichCompanyContext,
  type EnrichMeeting,
} from "@/lib/enrich-meetings";

// Unit coverage for the pure enrich-from-meetings helpers. Asserts the parser
// pulls a JSON object out of fenced / prose-wrapped output, coerces every field
// to a bounded string, treats the literal "null" and a mere echo of the current
// industry as empty, and signals failure (null) when every writable field is
// empty; and that the prompt embeds the current field values plus each meeting
// block (title, summary, action items).

const CURRENT_INDUSTRY = "Manufacturing";

const full = JSON.stringify({
  summary: "They are scaling and need capital plus a land-use attorney.",
  lookingFor: "growth capital and a land-use attorney for a Catskill site",
  canOffer: "contract manufacturing capacity and supplier relationships",
  industry: "Advanced Manufacturing",
  notesAppend: "Board approved a Series B raise. Targeting a Q4 site decision.",
});

describe("parseProfileEnrichment", () => {
  test("extracts every field from a clean JSON object", () => {
    const e = parseProfileEnrichment(full, CURRENT_INDUSTRY);
    expect(e).not.toBeNull();
    expect(e).toEqual({
      summary: "They are scaling and need capital plus a land-use attorney.",
      lookingFor: "growth capital and a land-use attorney for a Catskill site",
      canOffer: "contract manufacturing capacity and supplier relationships",
      industry: "Advanced Manufacturing",
      notesAppend: "Board approved a Series B raise. Targeting a Q4 site decision.",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Sure:\n```json\n" + full + "\n```\nDone.";
    const e = parseProfileEnrichment(raw, CURRENT_INDUSTRY);
    expect(e).not.toBeNull();
    expect(e!.lookingFor).toContain("growth capital");
  });

  test("clears an industry that merely echoes the current one (case-insensitive)", () => {
    const e = parseProfileEnrichment(
      JSON.stringify({ lookingFor: "capital", industry: "manufacturing" }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.industry).toBe("");
    expect(e!.lookingFor).toBe("capital");
  });

  test("treats the literal string \"null\" as empty", () => {
    const e = parseProfileEnrichment(
      JSON.stringify({ lookingFor: "null", canOffer: "real capability", notesAppend: "null" }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.lookingFor).toBe("");
    expect(e!.notesAppend).toBe("");
    expect(e!.canOffer).toBe("real capability");
  });

  test("coerces non-string fields to empty strings", () => {
    const e = parseProfileEnrichment(
      JSON.stringify({ canOffer: "capacity", lookingFor: 42, notesAppend: null }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.lookingFor).toBe("");
    expect(e!.notesAppend).toBe("");
    expect(e!.canOffer).toBe("capacity");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseProfileEnrichment("no json here", CURRENT_INDUSTRY)).toBeNull();
    expect(parseProfileEnrichment("", CURRENT_INDUSTRY)).toBeNull();
  });

  test("returns null when every writable field is empty", () => {
    // A summary alone (display-only) is not enough — nothing writable came back.
    const e = parseProfileEnrichment(
      JSON.stringify({ summary: "a recap", industry: "manufacturing" }),
      CURRENT_INDUSTRY,
    );
    expect(e).toBeNull();
  });

  test("keeps an enrichment with only a notes append", () => {
    const e = parseProfileEnrichment(
      JSON.stringify({ notesAppend: "New strategic context worth recording." }),
      CURRENT_INDUSTRY,
    );
    expect(e).not.toBeNull();
    expect(e!.notesAppend).toBe("New strategic context worth recording.");
    expect(e!.lookingFor).toBe("");
  });
});

describe("buildEnrichMeetingsPrompt", () => {
  const context: EnrichCompanyContext = {
    orgName: "Acme Mills",
    contactName: "Jane Doe",
    industry: "Manufacturing",
    lookingFor: "site selection help",
    canOffer: "",
  };
  const meetings: EnrichMeeting[] = [
    {
      date: "2026-06-01",
      title: "Q3 check-in",
      summary: "Discussed the IDA application and a possible Series B.",
      actionItems: ["Send the IDA draft", "Intro to a land-use attorney"],
    },
    {
      date: "2026-05-10",
      title: "Intro call",
      summary: "First meeting; they run a mill in Kingston.",
      actionItems: [],
    },
  ];

  test("embeds the current field values and each meeting block", () => {
    const prompt = buildEnrichMeetingsPrompt(context, meetings);
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Primary Contact: Jane Doe");
    expect(prompt).toContain("Current — Looking For: site selection help");
    // An empty current field shows a placeholder, not a blank.
    expect(prompt).toContain("Current — Can Offer: (empty)");
    expect(prompt).toContain("[2026-06-01] Q3 check-in");
    expect(prompt).toContain("Action items: Send the IDA draft; Intro to a land-use attorney");
    expect(prompt).toContain("[2026-05-10] Intro call");
    // The exact JSON shape we consume is requested.
    expect(prompt).toContain('"notesAppend"');
  });

  test("omits the action-items line for a meeting with none", () => {
    const prompt = buildEnrichMeetingsPrompt(context, [meetings[1]]);
    expect(prompt).toContain("[2026-05-10] Intro call");
    expect(prompt).not.toContain("Action items:");
  });
});
