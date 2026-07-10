"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";
import type { FocusHorizon, FocusItem } from "@/lib/daily-focus";

import { generateDailyFocus, type DailyFocusState } from "./daily-focus-actions";

// Client shell for Daily Focus (gap-audit cluster B). Holds only view state — the
// active horizon tab — while the whole assembly + synthesis runs in the
// generateDailyFocus server action, so the Anthropic key never crosses to the
// browser. The briefing is ephemeral: it lives in this component's action state
// and is regenerated on demand, never persisted.
//
// Switching horizon shows the generate prompt again until that horizon is run —
// each briefing is written from a different item set, so we never show one
// horizon's text under another's tab.

const initialState: DailyFocusState = { status: "idle" };

const TABS: Array<{ key: FocusHorizon; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

export function DailyFocus() {
  const [horizon, setHorizon] = useState<FocusHorizon>("today");
  const [state, formAction, isPending] = useActionState(
    generateDailyFocus,
    initialState,
  );

  // Only show a result under the tab it was generated for.
  const current =
    (state.status === "ok" || state.status === "empty") &&
    state.horizon === horizon
      ? state
      : null;

  const buttonLabel = isPending
    ? "Thinking\u2026"
    : current?.status === "ok"
      ? "Refresh"
      : "Generate";

  return (
    <Card>
      <CardHeader
        title="Daily Focus"
        action={
          <form action={formAction}>
            <input type="hidden" name="horizon" value={horizon} />
            <Button type="submit" variant="gold" disabled={isPending}>
              {buttonLabel}
            </Button>
          </form>
        }
      />

      {/* Horizon tabs */}
      <div className="flex border-b border-line px-2">
        {TABS.map((t) => {
          const active = t.key === horizon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setHorizon(t.key)}
              className={
                active
                  ? "border-b-2 border-teal-line px-3 py-2 text-[11px] font-semibold text-ink"
                  : "border-b-2 border-transparent px-3 py-2 text-[11px] text-ink-3 transition-colors hover:text-ink"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="px-[1.1rem] py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-600">{state.message}</p>
        ) : current?.status === "empty" ? (
          <p className="text-xs text-ink-3 italic">
            {emptyMessage(horizon)}
          </p>
        ) : current?.status === "ok" ? (
          <div>
            <p className="mb-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-2 italic">
              {current.synthesis}
            </p>
            <ul className="flex flex-col gap-1">
              {current.items.map((item) => (
                <FocusRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            Generate a briefing of what most needs your attention{" "}
            {horizonPhrase(horizon)} — grounded in your open commitments and
            upcoming events.
          </p>
        )}
      </div>
    </Card>
  );
}

function FocusRow({ item }: { item: FocusItem }) {
  return (
    <li className="flex items-start gap-2 border-b border-line py-1.5 last:border-b-0">
      <span
        className={
          item.kind === "event"
            ? "mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-ink"
            : "mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold"
        }
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] text-ink">{item.text}</div>
        <div className="truncate text-[10px] text-ink-3">{item.detail}</div>
      </div>
      <span
        className={
          item.overdue
            ? "flex-shrink-0 text-[10px] font-semibold whitespace-nowrap text-red-ink"
            : "flex-shrink-0 text-[10px] whitespace-nowrap text-ink-3"
        }
      >
        {item.timing}
      </span>
    </li>
  );
}

function emptyMessage(horizon: FocusHorizon): string {
  if (horizon === "week")
    return "Nothing time-bound this week — you are ahead of schedule.";
  if (horizon === "month")
    return "Nothing significant due this month — a good position.";
  return "All clear — nothing outstanding today.";
}

function horizonPhrase(horizon: FocusHorizon): string {
  if (horizon === "week") return "this week";
  if (horizon === "month") return "this month";
  return "today";
}
