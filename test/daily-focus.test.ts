import { describe, expect, test } from "vitest";

import {
  buildFocusContext,
  buildFocusItems,
  FOCUS_ITEM_CAP,
  type FocusCommitment,
  type FocusEvent,
} from "@/lib/daily-focus";
import { applyAgendaStates } from "@/lib/agenda-state";

// Pure-logic tests for the Daily Focus shaping: horizon windowing (overdue always
// in, future bounded by the horizon edge), undated-commitment inclusion at the
// lowest rank (backlog), past-event exclusion, events-before-commitments ordering,
// and the numbered context block.

// Fixed "now" = 2026-07-09. Both `now` and the item dates are built on the UTC
// calendar so dueInDays = (day - 9) is deterministic in EVERY timezone —
// including positive-offset zones where a local-midnight `now` would roll back a
// UTC day and skew the horizon windowing (the off-by-one this suite guards).
const now = new Date(Date.UTC(2026, 6, 9));
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
  test("today horizon: overdue + due-today, then undated as backlog; future windowed out", () => {
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
    // Dated items sort by urgency first; the undated commitment always surfaces but
    // settles last as backlog. The future-dated one is past today's edge → dropped.
    expect(items.map((i) => i.id)).toEqual(["overdue", "today", "undated"]);
    const undated = items.find((i) => i.id === "undated")!;
    expect(undated.timing).toBe("no due date");
    expect(undated.overdue).toBe(false);
  });

  test("undated commitments surface in every horizon at the bottom", () => {
    const input = {
      commitments: [
        commitment({ id: "dated", dueDate: on(9) }),
        commitment({ id: "undated", dueDate: null }),
      ],
      events: [],
    };
    for (const horizon of ["today", "week", "month"] as const) {
      const items = buildFocusItems(input, horizon, now);
      expect(items.map((i) => i.id)).toEqual(["dated", "undated"]);
    }
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

  test("returns the full prioritised pool (cap applied by the caller)", () => {
    const commitments = Array.from({ length: 12 }, (_, i) =>
      commitment({ id: `c${i}`, dueDate: on(9) }),
    );
    const items = buildFocusItems({ commitments, events: [] }, "month", now);
    expect(items).toHaveLength(12);
  });

  test("completing a top item promotes the next-ranked one into the capped view", () => {
    // 10 items due on staggered days so their priority order is c0..c9.
    const commitments = Array.from({ length: 10 }, (_, i) =>
      commitment({ id: `c${i}`, dueDate: on(9 + i) }),
    );
    const built = buildFocusItems({ commitments, events: [] }, "month", now);
    // Untouched: the capped view is the first FOCUS_ITEM_CAP in priority order.
    const before = built.slice(0, FOCUS_ITEM_CAP);
    expect(before.map((i) => i.id)).toEqual([
      "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7",
    ]);
    // Mark the top two done, then re-fold the overlay and cap: the freed slots
    // backfill with c8 and c9 rather than the list simply shrinking to six.
    const after = applyAgendaStates(
      built,
      [
        { kind: "commitment", refId: "c0", state: "done", snoozedUntil: null },
        { kind: "commitment", refId: "c1", state: "done", snoozedUntil: null },
      ],
      now,
    ).slice(0, FOCUS_ITEM_CAP);
    expect(after).toHaveLength(FOCUS_ITEM_CAP);
    expect(after.map((i) => i.id)).toEqual([
      "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9",
    ]);
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
