import { describe, expect, test } from "vitest";

import {
  applyAgendaStates,
  isAgendaItemKind,
  isAgendaState,
  snoozeUntil,
  type StoredAgendaState,
} from "@/lib/agenda-state";
import type { FocusItem } from "@/lib/daily-focus";

// Pure-logic tests for the Daily Focus triage overlay: done items and unexpired
// snoozes drop, expired snoozes resurface untouched, waiting items stay tagged,
// and the state/kind guards + snooze deadline.

const now = new Date(2026, 6, 20, 9); // fixed "now": 2026-07-20 09:00 local

function item(over: Partial<FocusItem>): FocusItem {
  return {
    id: over.id ?? "c1",
    kind: over.kind ?? "commitment",
    text: over.text ?? "Send the deck",
    detail: over.detail ?? "We owe · Acme",
    timing: over.timing ?? "due today",
    dueInDays: over.dueInDays ?? 0,
    overdue: over.overdue ?? false,
    source: over.source ?? "Commitment",
  };
}

function stored(over: Partial<StoredAgendaState>): StoredAgendaState {
  return {
    kind: over.kind ?? "commitment",
    refId: over.refId ?? "c1",
    state: over.state ?? "waiting",
    snoozedUntil: over.snoozedUntil ?? null,
  };
}

describe("applyAgendaStates", () => {
  test("attaches null state to untouched items and preserves order", () => {
    const items = [item({ id: "c1" }), item({ id: "e1", kind: "event" })];
    const result = applyAgendaStates(items, [], now);
    expect(result.map((r) => [r.id, r.state])).toEqual([
      ["c1", null],
      ["e1", null],
    ]);
  });

  test("drops done items entirely", () => {
    const result = applyAgendaStates(
      [item({ id: "c1" }), item({ id: "c2" })],
      [stored({ refId: "c1", state: "done" })],
      now,
    );
    expect(result.map((r) => r.id)).toEqual(["c2"]);
  });

  test("hides an unexpired snooze but tags nothing else", () => {
    const future = new Date(now.getTime() + 3_600_000); // 1h ahead
    const result = applyAgendaStates(
      [item({ id: "c1" }), item({ id: "c2" })],
      [stored({ refId: "c1", state: "snoozed", snoozedUntil: future })],
      now,
    );
    expect(result.map((r) => r.id)).toEqual(["c2"]);
  });

  test("an expired snooze resurfaces the item untouched", () => {
    const past = new Date(now.getTime() - 3_600_000); // 1h ago
    const result = applyAgendaStates(
      [item({ id: "c1" })],
      [stored({ refId: "c1", state: "snoozed", snoozedUntil: past })],
      now,
    );
    expect(result).toEqual([{ ...item({ id: "c1" }), state: null }]);
  });

  test("keeps a waiting item and carries its state through", () => {
    const result = applyAgendaStates(
      [item({ id: "c1" })],
      [stored({ refId: "c1", state: "waiting" })],
      now,
    );
    expect(result).toEqual([{ ...item({ id: "c1" }), state: "waiting" }]);
  });

  test("matches on kind AND refId — a same-id event is unaffected by a commitment mark", () => {
    const result = applyAgendaStates(
      [item({ id: "x", kind: "commitment" }), item({ id: "x", kind: "event" })],
      [stored({ kind: "commitment", refId: "x", state: "done" })],
      now,
    );
    expect(result.map((r) => [r.kind, r.state])).toEqual([["event", null]]);
  });
});

describe("guards + snooze deadline", () => {
  test("isAgendaState accepts the taxonomy, rejects others", () => {
    expect(isAgendaState("done")).toBe(true);
    expect(isAgendaState("snoozed")).toBe(true);
    expect(isAgendaState("waiting")).toBe(true);
    expect(isAgendaState("clear")).toBe(false);
    expect(isAgendaState("")).toBe(false);
  });

  test("isAgendaItemKind accepts commitment/event only", () => {
    expect(isAgendaItemKind("commitment")).toBe(true);
    expect(isAgendaItemKind("event")).toBe(true);
    expect(isAgendaItemKind("project")).toBe(false);
  });

  test("snoozeUntil is the start of the next local day", () => {
    expect(snoozeUntil(now)).toEqual(new Date(2026, 6, 21));
  });
});
