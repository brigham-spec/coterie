"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { suggestIntros, type IntroSuggestState } from "./actions";
import type { IntroSuggestion } from "@/lib/intro-engine";

// Client shell for per-member intro suggestions (slice 11.4b). Like the AI brief,
// this holds only view state — the reasoning runs in the `suggestIntros` server
// action, so the Anthropic key never crosses to the browser. Suggestions are
// EPHEMERAL: they live in this component's action state and are regenerated on
// demand, never persisted (a durable dismiss/accept ledger arrives in 11.4c).

const initialState: IntroSuggestState = { status: "idle" };

export function IntroSuggestions({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    suggestIntros,
    initialState,
  );

  return (
    <Card>
      <CardHeader
        title="Suggested introductions"
        action={
          <form action={formAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending
                ? "Thinking…"
                : state.status === "ok"
                  ? "Refresh"
                  : "Suggest introductions"}
            </Button>
          </form>
        }
      />
      <div className="px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-600">{state.message}</p>
        ) : state.status === "ok" ? (
          state.suggestions.length === 0 ? (
            <p className="text-xs text-ink-3">
              No strong introductions surfaced from the current network.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.suggestions.map((s) => (
                <SuggestionCard key={s.companyId} s={s} />
              ))}
            </ul>
          )
        ) : (
          <p className="text-xs text-ink-3">
            Scan the network for companies this one should be introduced to, and
            why.
          </p>
        )}
      </div>
    </Card>
  );
}

function SuggestionCard({ s }: { s: IntroSuggestion }) {
  return (
    <li className="rounded-md border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-ink">{s.companyName}</div>
          <div className="mt-0.5 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            {s.connectionType}
          </div>
        </div>
        <ScorePill score={s.score} />
      </div>
      <p className="mt-2 text-xs font-medium text-ink-2">{s.headline}</p>
      <p className="mt-1 text-xs text-ink-2">{s.whatItAdvances}</p>
      <p className="mt-1 text-[11px] text-ink-3 italic">{s.whyNow}</p>
      {s.talkingPoints.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {s.talkingPoints.map((t, i) => (
            <li key={i} className="text-[11px] text-ink-2">
              · {t}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className="shrink-0 rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[11px] font-medium text-gold">
      {score}/5
    </span>
  );
}
