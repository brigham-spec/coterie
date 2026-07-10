import { describe, expect, test } from "vitest";

import {
  buildFocusContext,
  buildFocusItems,
  type FocusCommitment,
  type FocusEvent,
} from "@/lib/daily-focus";

// Pure-logic tests for the Daily Focus shaping: horizon windowing (overdue always
// in, future bounded by the horizon edge), undated-commitment exclusion, past-event
// exclusion, events-before-commitments ordering, and the numbered context block.

// Fixed "now" = 2026-07-09 (local midnight; its y/m/d is TZ-stable). Dates are
// built in UTC so dueInDays = (day - 9) is deterministic across zones.
const now = new Date(2026, 6, 9);
const on = (day: number) => new Date(Date.UTC(2026, 6, day));

function commitment(over: Partial<FocusCommitment>): FocusCommitment {
  return {
    id: over.id ?? "c",
    text: over.text ?? "commitment",
    side: over.side ?? "they_owe",
    ownerName: over.ownerName ?? "Guest",
    companyName: over.companyName ?? null,
    meetingTitle: over.meetingTitle ?? null,
    dueDate: over.dueDate ?? null,
  };
}

function event(over: Partial<FocusEvent>): FocusEvent {
  return {
    id: over.id ?? "e",
    name: over.name ?? "Event",
    date: over.date ?? null,
    venue: over.venue ?? null,
  };
}

describe("buildFocusItems", () => {
  test("today horizon: overdue + due-today only, undated excluded", () => {
    const items = buildFocusItems(
      {
        commitments: [
          commitment({ id: "overdue", dueDate: on(1) }),
          commitment({ id: "today", dueDate: on(9) }),
          commitment({ id: "future", dueDate: on(14) }),
          commitment({ id: "undated", dueDate: null }),
        ],
        events: [],
      },
      "today",
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["overdue", "today"]);
  });

  test("week horizon reaches 7 days out; month reaches 30", () => {
    const commitments = [
      commitment({ id: "overdue", dueDate: on(1) }),
      commitment({ id: "in5", dueDate: on(14) }),
      commitment({ id: "in20", dueDate: on(29) }),
    ];
    const week = buildFocusItems({ commitments, events: [] }, "week", now);
    expect(week.map((i) => i.id)).toEqual(["overdue", "in5"]);

    const month = buildFocusItems({ commitments, events: [] }, "month", now);
    expect(month.map((i) => i.id)).toEqual(["overdue", "in5", "in20"]);
  });

  test("events sort ahead of commitments; past events excluded", () => {
    const items = buildFocusItems(
      {
        commitments: [commitment({ id: "overdue", dueDate: on(1) })],
        events: [
          event({ id: "past", date: on(5) }),
          event({ id: "soon", date: on(11) }),
          event({ id: "today-ev", date: on(9) }),
        ],
      },
      "week",
      now,
    );
    // Both upcoming events first (soonest first), then the commitment; past dropped.
    expect(items.map((i) => i.id)).toEqual(["today-ev", "soon", "overdue"]);
    expect(items.map((i) => i.kind)).toEqual([
      "event",
      "event",
      "commitment",
    ]);
  });

  test("marks overdue and labels timing; sides render into detail", () => {
    const items = buildFocusItems(
      {
        commitments: [
          commitment({
            id: "we",
            side: "we_owe",
            ownerName: "Staffer",
            companyName: null,
            dueDate: on(1),
          }),
          commitment({
            id: "they",
            side: "they_owe",
            ownerName: "Guest",
            companyName: "Acme",
            dueDate: on(9),
          }),
        ],
        events: [],
      },
      "today",
      now,
    );
    const we = items.find((i) => i.id === "we")!;
    const they = items.find((i) => i.id === "they")!;
    expect(we.overdue).toBe(true);
    expect(we.timing).toBe("8d overdue");
    expect(we.detail).toBe("We owe · Staffer");
    expect(they.overdue).toBe(false);
    expect(they.timing).toBe("due today");
    expect(they.detail).toBe("They owe · Guest · Acme");
  });

  test("caps at 8 items", () => {
    const commitments = Array.from({ length: 12 }, (_, i) =>
      commitment({ id: `c${i}`, dueDate: on(9) }),
    );
    const items = buildFocusItems({ commitments, events: [] }, "month", now);
    expect(items).toHaveLength(8);
  });
});

describe("buildFocusContext", () => {
  test("numbers items under the horizon label with timing and source", () => {
    const items = buildFocusItems(
      {
        commitments: [
          commitment({
            id: "we",
            text: "Send the deck",
            side: "we_owe",
            ownerName: "Staffer",
            companyName: null,
            meetingTitle: "Board sync",
            dueDate: on(1),
          }),
        ],
        events: [],
      },
      "today",
      now,
    );
    const ctx = buildFocusContext(items, "today");
    expect(ctx).toBe(
      "TODAY (priority order):\n1. Send the deck — We owe · Staffer (8d overdue) via Board sync",
    );
  });
});
