"use client";

import {
  useActionState,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button, Card, CardHeader } from "@/components/ui";
import type { FocusHorizon } from "@/lib/daily-focus";
import type { AgendaFocusItem, AgendaState } from "@/lib/agenda-state";

import {
  generateDailyFocus,
  setAgendaItemState,
  type DailyFocusState,
} from "./daily-focus-actions";

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

  // Optimistic triage overrides keyed by `${kind}:${id}`, applied over each item's
  // server-loaded state until the next Generate. "clear" undoes a mark.
  const [overrides, setOverrides] = useState<
    Record<string, AgendaState | "clear">
  >({});
  const [triageError, setTriageError] = useState(false);
  const [triagePending, startTriage] = useTransition();

  // A fresh briefing already reflects persisted state, so it supersedes the
  // session's local overrides. Reset during render when a new action result
  // arrives (the React "reset state when input changes" idiom) rather than in an
  // effect.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setOverrides({});
    setTriageError(false);
  }

  function triage(item: AgendaFocusItem, next: AgendaState | "clear") {
    const key = `${item.kind}:${item.id}`;
    setTriageError(false);
    setOverrides((o) => ({ ...o, [key]: next }));
    startTriage(async () => {
      const result = await setAgendaItemState(item.kind, item.id, next);
      if (result.status === "error") {
        setOverrides((o) => {
          const nextOverrides = { ...o };
          delete nextOverrides[key];
          return nextOverrides;
        });
        setTriageError(true);
      }
    });
  }

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
          <p className="text-xs text-red-ink">{state.message}</p>
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
              {current.items.map((item) => {
                const key = `${item.kind}:${item.id}`;
                const override = overrides[key];
                const effective =
                  override === "clear" ? null : (override ?? item.state);
                return (
                  <FocusRow
                    key={key}
                    item={item}
                    state={effective}
                    pending={triagePending}
                    onTriage={triage}
                  />
                );
              })}
            </ul>
            {triageError ? (
              <p className="mt-2 text-[10px] text-red-ink">
                Couldn&apos;t update that item. Try again.
              </p>
            ) : null}
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

function FocusRow({
  item,
  state,
  pending,
  onTriage,
}: {
  item: AgendaFocusItem;
  state: AgendaState | null;
  pending: boolean;
  onTriage: (item: AgendaFocusItem, next: AgendaState | "clear") => void;
}) {
  // A done or snoozed item collapses to a struck line with a session Undo — the
  // next Generate drops it entirely.
  if (state === "done" || state === "snoozed") {
    return (
      <li className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3 line-through">
          {item.text}
        </span>
        <span className="flex-shrink-0 text-[10px] whitespace-nowrap text-ink-3">
          {state === "done" ? "Done" : "Snoozed"}
        </span>
        <TriageButton pending={pending} onClick={() => onTriage(item, "clear")}>
          Undo
        </TriageButton>
      </li>
    );
  }

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
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <span
          className={
            item.overdue
              ? "text-[10px] font-semibold whitespace-nowrap text-red-ink"
              : "text-[10px] whitespace-nowrap text-ink-3"
          }
        >
          {item.timing}
        </span>
        <div className="flex items-center gap-1.5">
          {state === "waiting" ? (
            <>
              <span className="rounded-sm bg-amber-bg px-1.5 py-0.5 text-[9px] font-medium text-amber-ink">
                Waiting
              </span>
              <TriageButton
                pending={pending}
                onClick={() => onTriage(item, "clear")}
              >
                Clear
              </TriageButton>
            </>
          ) : (
            <>
              <TriageButton
                pending={pending}
                onClick={() => onTriage(item, "done")}
              >
                Done
              </TriageButton>
              <TriageButton
                pending={pending}
                onClick={() => onTriage(item, "snoozed")}
              >
                Snooze
              </TriageButton>
              <TriageButton
                pending={pending}
                onClick={() => onTriage(item, "waiting")}
              >
                Waiting
              </TriageButton>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function TriageButton({
  pending,
  onClick,
  children,
}: {
  pending: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="text-[9.5px] font-medium tracking-[0.04em] text-ink-3 uppercase transition-colors hover:text-gold disabled:opacity-50"
    >
      {children}
    </button>
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
