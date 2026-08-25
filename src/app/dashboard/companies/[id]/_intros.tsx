"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";

import { dismissIntro, suggestIntros, type IntroSuggestState } from "./actions";
import { INTRO_DISMISS_REASONS } from "@/lib/intro-dismissal";
import type { IntroSuggestion } from "@/lib/intro-engine";

// Client shell for per-member intro suggestions. Like the AI brief, this holds
// only view state — the reasoning runs in the `suggestIntros` server action, so
// the Anthropic key never crosses to the browser. The suggestions themselves are
// EPHEMERAL (regenerated on demand, never stored), but each one can be acted on:
// LOG it — deep-linked to the introductions log form, which resolves each company
// to its primary contact and seeds the two parties + headline — or DISMISS it with
// a reason (not relevant / competitor / wrong timing / other), which persists via
// dismissIntro so the same pair is suppressed on the next Refresh.

const initialState: IntroSuggestState = { status: "idle" };

export function IntroSuggestions({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    suggestIntros,
    initialState,
  );
  // Locally hide dismissed cards from the current list. The dismissal is also
  // persisted (dismissIntro) so a later Refresh — which re-queries the DB —
  // already excludes it; a stale id here is harmless (it won't be in the new list).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const visible =
    state.status === "ok"
      ? state.suggestions.filter((s) => !dismissed.has(s.companyId))
      : [];

  return (
    <CollapsibleCard
      id="company-intro-suggestions"
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
    >
      <div className="px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          visible.length === 0 ? (
            <p className="text-xs text-ink-3">
              No strong introductions surfaced from the current network.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visible.map((s) => (
                <SuggestionCard
                  key={s.companyId}
                  s={s}
                  focusId={companyId}
                  onDismiss={(id) =>
                    setDismissed((prev) => new Set(prev).add(id))
                  }
                />
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
    </CollapsibleCard>
  );
}

function SuggestionCard({
  s,
  focusId,
  onDismiss,
}: {
  s: IntroSuggestion;
  focusId: string;
  onDismiss: (candidateId: string) => void;
}) {
  const [isDismissing, startDismiss] = useTransition();
  // Deep-link to the introductions log form, which resolves each company to its
  // primary contact and seeds the two parties + headline (same path the
  // dashboard scanner and the co-attendance panel use).
  const logHref = `/dashboard/introductions?logCompanyA=${focusId}&logCompanyB=${s.companyId}&logText=${encodeURIComponent(s.headline)}#log-intro`;

  function dispose(reason: string) {
    // Optimistically hide, then persist with the chosen reason. If the write
    // fails the card stays hidden for this session but simply reappears on the
    // next Refresh (which re-queries the DB and already excludes it).
    onDismiss(s.companyId);
    startDismiss(async () => {
      await dismissIntro(focusId, s.companyId, reason);
    });
  }

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
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
        <Link
          href={logHref}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          Log intro
        </Link>
        <span className="text-[9.5px] text-ink-3">Dismiss as</span>
        {INTRO_DISMISS_REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => dispose(r.value)}
            disabled={isDismissing}
            className="text-[10px] text-ink-3 hover:text-ink-2 hover:underline disabled:opacity-50"
          >
            {r.label}
          </button>
        ))}
      </div>
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
