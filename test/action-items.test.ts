import { describe, it, expect } from "vitest";

import {
  parseActionItemCandidates,
  extractionNotes,
  type OwnerCandidate,
} from "@/lib/action-items";

// Unit test for the action-item extractor's PURE surface (gap-audit cluster A).
// No DB, no Anthropic call — guards the defensive parser and, critically, the
// owner resolution that maps a model's free-text name onto a real staff user or
// meeting-attendee contact (or leaves it "unknown" for a human). The AI call
// itself (generateActionItems) is the single impure seam, exercised at runtime.

const staff: OwnerCandidate[] = [
  { id: "u1", name: "Brigham Farrand" },
  { id: "u2", name: "Sarah Lee" },
];
const contacts: OwnerCandidate[] = [
  { id: "c1", name: "Bob George" },
  { id: "c2", name: "Jane Doe" },
];

describe("parseActionItemCandidates", () => {
  it("resolves owners to staff, then contacts, else unknown", () => {
    const raw = JSON.stringify([
      { text: "Send the IDA draft", owner: "Sarah Lee" },
      { text: "Introduce to the CFO", owner: "Bob George" },
      { text: "Follow up next week", owner: "Someone Else" },
    ]);
    const out = parseActionItemCandidates(raw, staff, contacts);
    expect(out).toEqual([
      {
        text: "Send the IDA draft",
        ownerName: "Sarah Lee",
        ownerKind: "staff",
        ownerId: "u2",
      },
      {
        text: "Introduce to the CFO",
        ownerName: "Bob George",
        ownerKind: "contact",
        ownerId: "c1",
      },
      {
        text: "Follow up next week",
        ownerName: "Someone Else",
        ownerKind: "unknown",
        ownerId: null,
      },
    ]);
  });

  it("matches owner names case-insensitively and trimmed", () => {
    const raw = JSON.stringify([{ text: "Call back", owner: "  brigham farrand " }]);
    const [c] = parseActionItemCandidates(raw, staff, contacts);
    expect(c.ownerKind).toBe("staff");
    expect(c.ownerId).toBe("u1");
  });

  it("treats an empty or missing owner as unknown", () => {
    const raw = JSON.stringify([
      { text: "Draft the memo", owner: "" },
      { text: "Book the room" },
    ]);
    const out = parseActionItemCandidates(raw, staff, contacts);
    expect(out.map((c) => c.ownerKind)).toEqual(["unknown", "unknown"]);
    expect(out.every((c) => c.ownerId === null)).toBe(true);
  });

  it("drops entries with empty or non-string text", () => {
    const raw = JSON.stringify([
      { text: "   ", owner: "Sarah Lee" },
      { text: 42, owner: "Sarah Lee" },
      { text: "Real item", owner: "Sarah Lee" },
    ]);
    const out = parseActionItemCandidates(raw, staff, contacts);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Real item");
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Here you go:\n```json\n[{"text":"Send deck","owner":"Sarah Lee"}]\n```\ndone';
    const out = parseActionItemCandidates(raw, staff, contacts);
    expect(out).toHaveLength(1);
    expect(out[0].ownerId).toBe("u2");
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseActionItemCandidates("not json", staff, contacts)).toEqual([]);
    expect(parseActionItemCandidates("{}", staff, contacts)).toEqual([]);
    expect(parseActionItemCandidates('{"text":"x"}', staff, contacts)).toEqual([]);
  });

  it("loosely resolves a first name to a unique full-name candidate", () => {
    const raw = JSON.stringify([
      { text: "Send the draft", owner: "Brigham" },
      { text: "Introduce the CFO", owner: "Jane" },
    ]);
    const out = parseActionItemCandidates(raw, staff, contacts);
    expect(out[0].ownerKind).toBe("staff");
    expect(out[0].ownerId).toBe("u1");
    expect(out[1].ownerKind).toBe("contact");
    expect(out[1].ownerId).toBe("c2");
  });

  it("leaves an ambiguous partial name unknown rather than guessing", () => {
    // Two staff share the first token "Sam" — a partial match must not pick one.
    const ambiguousStaff: OwnerCandidate[] = [
      { id: "u1", name: "Sam Adams" },
      { id: "u2", name: "Sam Brooks" },
    ];
    const raw = JSON.stringify([{ text: "Circle back", owner: "Sam" }]);
    const [c] = parseActionItemCandidates(raw, ambiguousStaff, contacts);
    expect(c.ownerKind).toBe("unknown");
    expect(c.ownerId).toBeNull();
  });

  it("prefers staff over contacts on a loose match tie", () => {
    const staffAndContactShareFirstName: OwnerCandidate[] = [
      { id: "u9", name: "Alex Green" },
    ];
    const contactSameFirst: OwnerCandidate[] = [{ id: "c9", name: "Alex Stone" }];
    const raw = JSON.stringify([{ text: "Task", owner: "Alex" }]);
    const [c] = parseActionItemCandidates(
      raw,
      staffAndContactShareFirstName,
      contactSameFirst,
    );
    expect(c.ownerKind).toBe("staff");
    expect(c.ownerId).toBe("u9");
  });
});

describe("extractionNotes", () => {
  it("prefers the structured action_items text when long enough", () => {
    const notes = extractionNotes({
      actionItemsText: "Sarah to send the IDA application draft by Friday.",
      summary: "The meeting covered onboarding and next steps.",
    });
    expect(notes).toBe("Sarah to send the IDA application draft by Friday.");
  });

  it("falls back to the summary when action_items is too short or absent", () => {
    expect(
      extractionNotes({
        actionItemsText: "N/A",
        summary: "A thorough overview of the strategic discussion held.",
      }),
    ).toBe("A thorough overview of the strategic discussion held.");
    expect(
      extractionNotes({
        actionItemsText: null,
        summary: "A thorough overview of the strategic discussion held.",
      }),
    ).toBe("A thorough overview of the strategic discussion held.");
  });

  it("returns an empty string when neither field is usable", () => {
    expect(extractionNotes({ actionItemsText: null, summary: null })).toBe("");
    expect(extractionNotes({ actionItemsText: "  ", summary: "  " })).toBe("");
  });
});
