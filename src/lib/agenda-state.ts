// Agenda item state overlay (Dashboard 8, ported from the prototype's per-item
// done/snooze/waiting triage on the Daily Focus card, Coterie.html:19630). The
// focus items themselves are ephemeral — regenerated on demand from live
// commitments and events — but each maps to a DURABLE row (an actionItem or an
// event), so a lightweight overlay keyed by (kind, refId) can carry the operator's
// triage across regenerations without persisting the briefing text.
//
// PURE — no I/O, no server-only. The action loads the stored states inside its
// withOrg tx and calls applyAgendaStates to fold them onto the built focus items,
// so the windowing here is unit-testable without a database.

import type { FocusItem } from "./daily-focus";

// The three triage states. "done" = dealt with (drops off the focus); "snoozed" =
// hidden until snoozedUntil (a later day); "waiting" = blocked on someone else, so
// it stays visible but tagged rather than chased.
export const AGENDA_STATES = ["done", "snoozed", "waiting"] as const;
export type AgendaState = (typeof AGENDA_STATES)[number];

const AGENDA_STATE_SET = new Set<string>(AGENDA_STATES);

export function isAgendaState(value: string): value is AgendaState {
  return AGENDA_STATE_SET.has(value);
}

// The two kinds of focus item that can carry a state. Matches FocusItem.kind.
const ITEM_KINDS = new Set<string>(["commitment", "event"]);

export function isAgendaItemKind(value: string): boolean {
  return ITEM_KINDS.has(value);
}

// A stored overlay row, reduced to what folding needs. `snoozedUntil` is only
// meaningful for a "snoozed" row.
export interface StoredAgendaState {
  kind: string;
  refId: string;
  state: AgendaState;
  snoozedUntil: Date | null;
}

// A focus item with its active triage state attached (null = untouched).
export type AgendaFocusItem = FocusItem & { state: AgendaState | null };

function stateKey(kind: string, refId: string): string {
  return `${kind}:${refId}`;
}

/// PURE: fold the stored overlay onto the built focus items. A "done" item and a
/// still-snoozed item (snoozedUntil in the future) are dropped from the list; an
/// EXPIRED snooze is treated as cleared so the item resurfaces untouched; a
/// "waiting" item stays but carries its state so the card can tag it. Order is
/// preserved (the items arrive already prioritised).
export function applyAgendaStates(
  items: FocusItem[],
  stored: readonly StoredAgendaState[],
  now: Date,
): AgendaFocusItem[] {
  const byKey = new Map<string, StoredAgendaState>();
  for (const s of stored) byKey.set(stateKey(s.kind, s.refId), s);

  const result: AgendaFocusItem[] = [];
  for (const item of items) {
    const s = byKey.get(stateKey(item.kind, item.id));
    if (s == null) {
      result.push({ ...item, state: null });
      continue;
    }
    if (s.state === "done") continue;
    if (s.state === "snoozed") {
      // An unexpired snooze hides the item; once it lapses the item returns as if
      // untouched (the stale row is harmless until re-set).
      if (s.snoozedUntil != null && s.snoozedUntil.getTime() > now.getTime())
        continue;
      result.push({ ...item, state: null });
      continue;
    }
    result.push({ ...item, state: "waiting" });
  }
  return result;
}

// Start of the day AFTER `now` (local calendar) — the instant a snooze lapses so a
// snoozed item resurfaces the next day.
export function snoozeUntil(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}
