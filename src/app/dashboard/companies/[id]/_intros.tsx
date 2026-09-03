"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Button, cn } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";

import { dismissIntro, suggestIntros } from "./actions";
import { INTRO_DISMISS_REASONS } from "@/lib/intro-dismissal";
import { isProactiveCacheFresh, relativeAge } from "@/lib/proactive-cache";
import type { IntroSuggestSnapshot } from "@/lib/intro-suggestion-cache";
import type { IntroSuggestion } from "@/lib/intro-engine";

// Client shell for per-member intro suggestions. Like the AI brief, this holds
// only view state — the reasoning runs in the `suggestIntros` server action, so
// the Anthropic key never crosses to the browser.
//
// It HYDRATES from the last saved per-company scan (IntroSuggestionCache) so the
// card renders instantly on revisit instead of re-firing the paid AI scan every
// time the profile is opened. Like the dashboard scanner it NEVER auto-fires on a
// stale cache; the operator refreshes on demand when they want NEW suggestions, and
// an age label (plus a gold "refresh for the latest" hint once past the TTL) tells
// them how current the view is. A Refresh only supersedes the cached view on
// success — a transient AI failure surfaces alongside it, never wiping it.
//
// Each suggestion can be acted on: LOG it — deep-linked to the introductions log
// form, which resolves each company to its primary contact and seeds the two
// parties + headline — or DISMISS it with a reason (not relevant / competitor /
// wrong timing / other), which persists via dismissIntro so the same pair is
// suppressed on the next scan (and filtered out of the cache on read).

export function IntroSuggestions({
  companyId,
  initial,
}: {
  companyId: string;
  initial: IntroSuggestSnapshot | null;
}) {
  // Last-known-good suggestions (seeded from the cache). A refresh only replaces
  // them on success; errors surface alongside, not over, the cached view.
  const [snapshot, setSnapshot] = useState<IntroSuggestion[] | null>(
    initial ? initial.suggestions : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<number | null>(
    initial ? Date.parse(initial.generatedAt) : null,
  );
  // Locally hide dismissed cards from the current list. The dismissal is also
  // persisted (dismissIntro) so a later Refresh — which re-queries the DB —
  // already excludes it; a stale id here is harmless (it won't be in the new list).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  // Wall clock captured on mount (never during render — that would be impure and
  // could disagree with the server-rendered HTML on hydration).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNowMs(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const run = useCallback(() => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      const next = await suggestIntros({ status: "idle" }, fd);
      if (next.status === "ok") {
        setSnapshot(next.suggestions);
        setError(null);
        setAnalyzedAt(Date.now());
        setNowMs(Date.now());
        // The rescan re-queries the DB (already excluding server-side
        // dismissals), so the optimistic hide set starts clean.
        setDismissed(new Set());
      } else if (next.status === "error") {
        setError(next.message);
      }
    });
  }, [companyId]);

  const visible = snapshot
    ? snapshot.filter((s) => !dismissed.has(s.companyId))
    : [];
  const stale =
    analyzedAt !== null &&
    nowMs !== null &&
    !isProactiveCacheFresh(new Date(analyzedAt), nowMs);

  return (
    <CollapsibleCard
      id="company-intro-suggestions"
      title="Suggested introductions"
      action={
        <div className="flex items-center gap-2">
          {snapshot && nowMs !== null && analyzedAt !== null ? (
            <span
              className={cn("text-[10px]", stale ? "text-gold-ink" : "text-ink-3")}
            >
              updated {relativeAge(analyzedAt, nowMs)}
              {stale ? " · refresh for the latest" : ""}
            </span>
          ) : null}
          <Button
            type="button"
            variant="gold"
            disabled={pending}
            onClick={run}
          >
            {pending ? "Thinking…" : snapshot ? "Refresh" : "Suggest introductions"}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4">
        {/* Errors show alongside — never replacing — the last good scan. */}
        {error !== null ? (
          <p className="mb-2 text-xs text-red-ink">{error}</p>
        ) : null}

        {visible.length > 0 ? (
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
        ) : pending ? (
          <p className="text-xs text-ink-2">
            Scanning the network… this can take a moment.
          </p>
        ) : snapshot ? (
          <p className="text-xs text-ink-3">
            No strong introductions surfaced from the current network.
          </p>
        ) : error !== null ? null : (
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
          <Link
            href={`/dashboard/companies/${s.companyId}`}
            className="font-medium text-ink hover:text-gold hover:underline"
          >
            {s.companyName}
          </Link>
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
