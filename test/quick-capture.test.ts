import { describe, expect, test } from "vitest";

import {
  buildQuickCapturePrompt,
  parseQuickCapture,
  type CaptureContact,
} from "@/lib/quick-capture";

// Unit coverage for the pure quick-capture helpers. Asserts the parser pulls a
// JSON object out of fenced / prose-wrapped output, coerces every field, folds
// bullet/array follow-ups into a clean line list, defaults a missing/malformed
// date to today, drops empty intros/prospects, and signals failure (null) when
// nothing usable comes back; and that the prompt lists the roster with ids and
// embeds today + the note.

const TODAY = "2026-07-10";

const full = JSON.stringify({
  matchedContactIds: ["c1", "c2"],
  meetingTitle: "Coffee with Sarah",
  meetingDate: "2026-07-08",
  summary: "Caught up on the Catskill project; she needs a land use attorney.",
  actionItems: ["Follow up next Tuesday", "Send the zoning memo"],
  suggestedIntros: [{ toOrg: "Lang & Co", reason: "land use expertise" }],
  newProspects: [{ name: "Sarah Reed", org: "Bethel Woods", notes: "needs counsel" }],
});

describe("parseQuickCapture", () => {
  test("extracts every field from a clean JSON object", () => {
    const c = parseQuickCapture(full, TODAY);
    expect(c).not.toBeNull();
    expect(c).toEqual({
      matchedContactIds: ["c1", "c2"],
      title: "Coffee with Sarah",
      date: "2026-07-08",
      summary: "Caught up on the Catskill project; she needs a land use attorney.",
      actionItems: ["Follow up next Tuesday", "Send the zoning memo"],
      suggestedIntros: [{ toOrg: "Lang & Co", reason: "land use expertise" }],
      newProspects: [{ name: "Sarah Reed", org: "Bethel Woods", notes: "needs counsel" }],
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Sure:\n```json\n" + full + "\n```\nDone.";
    const c = parseQuickCapture(raw, TODAY);
    expect(c).not.toBeNull();
    expect(c!.title).toBe("Coffee with Sarah");
  });

  test("defaults a missing or malformed date to today", () => {
    const c = parseQuickCapture(
      JSON.stringify({ summary: "quick note", meetingDate: "next week" }),
      TODAY,
    );
    expect(c).not.toBeNull();
    expect(c!.date).toBe(TODAY);
  });

  test("folds a newline-delimited action-item string into clean lines", () => {
    const c = parseQuickCapture(
      JSON.stringify({
        summary: "s",
        actionItems: "- Call Ray\n• Email the deck\n\n  * Book room",
      }),
      TODAY,
    );
    expect(c).not.toBeNull();
    expect(c!.actionItems).toEqual(["Call Ray", "Email the deck", "Book room"]);
  });

  test("drops intros with no target and prospects with neither name nor org", () => {
    const c = parseQuickCapture(
      JSON.stringify({
        summary: "s",
        suggestedIntros: [{ toOrg: "", reason: "x" }, { toOrg: "Acme" }],
        newProspects: [{ notes: "orphan" }, { org: "Beta Corp" }],
      }),
      TODAY,
    );
    expect(c).not.toBeNull();
    expect(c!.suggestedIntros).toEqual([{ toOrg: "Acme", reason: "" }]);
    expect(c!.newProspects).toEqual([{ name: "", org: "Beta Corp", notes: "" }]);
  });

  test("returns null when no JSON object is present", () => {
    expect(parseQuickCapture("no json here", TODAY)).toBeNull();
    expect(parseQuickCapture("", TODAY)).toBeNull();
  });

  test("returns null when nothing usable came back", () => {
    // No matched ids, no follow-ups, no prospects, empty summary → failure.
    const c = parseQuickCapture(
      JSON.stringify({ meetingTitle: "Untitled", suggestedIntros: [] }),
      TODAY,
    );
    expect(c).toBeNull();
  });

  test("keeps a capture that has only a summary", () => {
    const c = parseQuickCapture(JSON.stringify({ summary: "just a note" }), TODAY);
    expect(c).not.toBeNull();
    expect(c!.summary).toBe("just a note");
    expect(c!.matchedContactIds).toEqual([]);
  });
});

describe("buildQuickCapturePrompt", () => {
  const contacts: CaptureContact[] = [
    { id: "c1", name: "Sarah Reed", org: "Bethel Woods" },
    { id: "c2", name: "Drew Lang", org: "Lang & Co" },
  ];

  test("lists the roster with ids and embeds today + the note", () => {
    const prompt = buildQuickCapturePrompt("Had coffee with Sarah.", contacts, TODAY);
    expect(prompt).toContain("[ID:c1] Sarah Reed — Bethel Woods");
    expect(prompt).toContain("[ID:c2] Drew Lang — Lang & Co");
    expect(prompt).toContain(`Today is ${TODAY}.`);
    expect(prompt).toContain("NOTE:");
    expect(prompt).toContain("Had coffee with Sarah.");
  });

  test("handles an empty roster", () => {
    const prompt = buildQuickCapturePrompt("solo note", [], TODAY);
    expect(prompt).toContain("(no contacts on record)");
  });

  test("caps an over-long note to keep the prompt bounded", () => {
    const long = "y".repeat(6000);
    const prompt = buildQuickCapturePrompt(long, contacts, TODAY);
    expect(prompt).not.toContain("y".repeat(4001));
    expect(prompt).toContain("y".repeat(4000));
  });
});
