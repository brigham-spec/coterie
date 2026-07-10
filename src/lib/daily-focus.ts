// Daily Focus (gap-audit cluster B, ported from the prototype's
// renderDailyFocusCard / generateFocusSynthesis at Coterie.html:19582 & 19454).
// The operator's morning surface: the time-bound items that most need attention
// across three horizons — Today, This Week, This Month — plus a two-to-three
// sentence AI briefing written from them.
//
// This module is PURE (no I/O, no server-only): the caller assembles the org's
// open commitments and upcoming events inside a withOrg tx, and these functions
// bucket/sort them by horizon and format the grounding block the model reads.
// Keeping it pure makes the horizon windowing and prioritisation unit-testable
// without a database or an API key.

const DAY = 86_400_000;

export type FocusHorizon = "today" | "week" | "month";

// How far ahead each horizon looks. Overdue items (negative dueInDays) surface in
// every horizon; the window only bounds how far into the future we reach.
const HORIZON_DAYS: Record<FocusHorizon, number> = {
  today: 0,
  week: 7,
  month: 30,
};

// An open commitment (action item), already org-scoped by the caller. `side` is
// which way the follow-up runs: staff-owned ("we owe") vs contact-owned
// ("they owe"). Undated commitments carry no urgency signal so they are omitted
// from the focus (they still live on the Commitments board).
export interface FocusCommitment {
  id: string;
  text: string;
  side: "we_owe" | "they_owe";
  ownerName: string;
  companyName: string | null;
  meetingTitle: string | null;
  dueDate: Date | null;
}

// An upcoming event, already org-scoped by the caller.
export interface FocusEvent {
  id: string;
  name: string;
  date: Date | null;
  venue: string | null;
}

export interface FocusInput {
  commitments: FocusCommitment[];
  events: FocusEvent[];
}

// A prioritised line for the card and the prompt. Fully serialisable (no Date) so
// the server action can hand it straight to the client card.
export interface FocusItem {
  id: string;
  kind: "commitment" | "event";
  text: string;
  detail: string;
  timing: string;
  dueInDays: number;
  overdue: boolean;
  source: string;
}

// Whole-day difference between two instants, computed from calendar days so a due
// date at any wall-clock time compares cleanly against "today". Negative = past.
function daysBetween(now: Date, then: Date): number {
  const startNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = Date.UTC(
    then.getUTCFullYear(),
    then.getUTCMonth(),
    then.getUTCDate(),
  );
  return Math.round((startThen - startNow) / DAY);
}

function timingLabel(dueInDays: number): string {
  if (dueInDays < 0) return `${Math.abs(dueInDays)}d overdue`;
  if (dueInDays === 0) return "due today";
  if (dueInDays === 1) return "due tomorrow";
  return `due in ${dueInDays}d`;
}

/// PURE: bucket the org's commitments and events into the prioritised list for a
/// horizon. A commitment is in if it is dated and its due day is on or before the
/// horizon's far edge (so overdue items surface in every horizon). An event is in
/// if it is dated and falls between today and the horizon edge (upcoming only —
/// past events are never a focus). Events sort ahead of commitments; within each
/// group the soonest/most-overdue come first, ties broken by text. Capped at 8.
export function buildFocusItems(
  input: FocusInput,
  horizon: FocusHorizon,
  now: Date,
): FocusItem[] {
  const windowDays = HORIZON_DAYS[horizon];
  const items: FocusItem[] = [];

  for (const c of input.commitments) {
    if (c.dueDate == null) continue;
    const dueInDays = daysBetween(now, c.dueDate);
    if (dueInDays > windowDays) continue;
    const owner = c.side === "we_owe" ? "We owe" : "They owe";
    const who = c.companyName ? `${c.ownerName} · ${c.companyName}` : c.ownerName;
    items.push({
      id: c.id,
      kind: "commitment",
      text: c.text,
      detail: `${owner} · ${who}`,
      timing: timingLabel(dueInDays),
      dueInDays,
      overdue: dueInDays < 0,
      source: c.meetingTitle ?? "Commitment",
    });
  }

  for (const e of input.events) {
    if (e.date == null) continue;
    const dueInDays = daysBetween(now, e.date);
    if (dueInDays < 0 || dueInDays > windowDays) continue;
    items.push({
      id: e.id,
      kind: "event",
      text: e.name,
      detail: e.venue ?? "Event",
      timing: timingLabel(dueInDays),
      dueInDays,
      overdue: false,
      source: "Events",
    });
  }

  items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
    if (a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
    return a.text.localeCompare(b.text);
  });

  return items.slice(0, 8);
}

const HORIZON_LABEL: Record<FocusHorizon, string> = {
  today: "TODAY",
  week: "THIS WEEK",
  month: "THIS MONTH",
};

/// PURE: format the numbered grounding block the model reads. Kept separate from
/// the network call so the shaping is unit-testable without an API key.
export function buildFocusContext(
  items: FocusItem[],
  horizon: FocusHorizon,
): string {
  const lines = items.map((item, i) => {
    const via = item.source ? ` via ${item.source}` : "";
    return `${i + 1}. ${item.text} — ${item.detail} (${item.timing})${via}`;
  });
  return `${HORIZON_LABEL[horizon]} (priority order):\n${lines.join("\n")}`;
}
