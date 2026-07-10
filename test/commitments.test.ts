import { describe, expect, test } from "vitest";

import { buildCommitmentBoard, type RawCommitment } from "@/lib/commitments";

// Pure-logic tests for the commitments board shaping: side classification,
// most-overdue-first ordering, undated-last, and the open/overdue counts.

// Fixed "now" = 2026-07-09 (local midnight; its y/m/d is TZ-stable). Due dates
// are built in UTC so dueInDays = (dueDay - 9) is deterministic across zones.
const now = new Date(2026, 6, 9);
const dueOn = (day: number) => new Date(Date.UTC(2026, 6, day));

function staffItem(over: Partial<RawCommitment>): RawCommitment {
  return {
    id: over.id ?? "s",
    text: over.text ?? "staff item",
    dueDate: over.dueDate ?? null,
    ownerUser: { name: "Staffer" },
    ownerContact: null,
    meeting: over.meeting ?? null,
  };
}

function contactItem(over: Partial<RawCommitment>): RawCommitment {
  return {
    id: over.id ?? "c",
    text: over.text ?? "contact item",
    dueDate: over.dueDate ?? null,
    ownerUser: null,
    ownerContact: { name: "Guest", company: { name: "Acme" } },
    meeting: over.meeting ?? null,
  };
}

describe("buildCommitmentBoard", () => {
  test("splits items by owner side", () => {
    const board = buildCommitmentBoard(
      [staffItem({ id: "a" }), contactItem({ id: "b" })],
      now,
    );
    expect(board.weOwe.map((c) => c.id)).toEqual(["a"]);
    expect(board.theyOwe.map((c) => c.id)).toEqual(["b"]);
  });

  test("orders most-overdue first, undated last", () => {
    const board = buildCommitmentBoard(
      [
        contactItem({ id: "upcoming", dueDate: dueOn(20) }),
        contactItem({ id: "undated", dueDate: null }),
        contactItem({ id: "overdue", dueDate: dueOn(1) }),
        contactItem({ id: "soon", dueDate: dueOn(10) }),
      ],
      now,
    );
    expect(board.theyOwe.map((c) => c.id)).toEqual([
      "overdue",
      "soon",
      "upcoming",
      "undated",
    ]);
  });

  test("computes signed dueInDays and overdue count", () => {
    const board = buildCommitmentBoard(
      [
        contactItem({ id: "past", dueDate: dueOn(1) }),
        contactItem({ id: "today", dueDate: dueOn(9) }),
        contactItem({ id: "future", dueDate: dueOn(15) }),
        contactItem({ id: "none", dueDate: null }),
      ],
      now,
    );
    const byId = Object.fromEntries(board.theyOwe.map((c) => [c.id, c.dueInDays]));
    expect(byId.past).toBe(-8);
    expect(byId.today).toBe(0);
    expect(byId.future).toBe(6);
    expect(byId.none).toBeNull();
    expect(board.overdueCount).toBe(1);
    expect(board.openCount).toBe(4);
  });

  test("carries company for they-owe, null for we-owe, and passes meeting title", () => {
    const board = buildCommitmentBoard(
      [
        staffItem({ id: "s", meeting: { title: "Board sync" } }),
        contactItem({ id: "c" }),
      ],
      now,
    );
    expect(board.weOwe[0].companyName).toBeNull();
    expect(board.weOwe[0].meetingTitle).toBe("Board sync");
    expect(board.theyOwe[0].companyName).toBe("Acme");
  });

  test("skips a malformed owner-less row", () => {
    const board = buildCommitmentBoard(
      [{ id: "x", text: "orphan", dueDate: null, ownerUser: null, ownerContact: null, meeting: null }],
      now,
    );
    expect(board.openCount).toBe(0);
  });
});
