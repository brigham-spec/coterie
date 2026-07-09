import { describe, it, expect } from "vitest";

import {
  parseActionItemCandidates,
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
});
