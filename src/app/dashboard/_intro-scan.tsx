"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Button, cn } from "@/components/ui";

import { scanNetworkIntros } from "./actions";
import { dismissIntro } from "./companies/[id]/actions";
import { INTRO_DISMISS_REASONS } from "@/lib/intro-dismissal";
import { isProactiveCacheFresh, relativeAge } from "@/lib/proactive-cache";
import type { ProactiveCacheSnapshot } from "./introductions/_engine";
import {
  CLUSTER_NOTE_MIN,
  ClusterNote,
  UrgencyBanner,
} from "./introductions/_pairing-signals";
import type { ProactivePairing } from "@/lib/intro-engine";

// Dashboard Layer-0 panel (slice 11.4c) — the proactive introduction scanner. A
// client shell over the scanNetworkIntros server action, so the Anthropic key
// never crosses to the browser.
//
// It HYDRATES from the last members-scope proactive scan (item 13) so the panel
// renders instantly instead of forcing a ~1-min AI scan on every dashboard
// visit. Unlike the engine's Urgent Signals panel it NEVER auto-fires on a stale
// cache — the dashboard loads on every login, and an auto-scan there would burn a
// paid AI call each time. The operator rescans on demand; an age label (and a
// gold "rescan for the latest" hint once the snapshot ages past the TTL) tells
// them how current the view is.
//
// Each surfaced pairing can be (a) LOGGED — deep-linked to the introductions log
// form, which resolves each company to its primary contact and seeds the two
// parties + headline — or (b) DISPOSITIONED with a reason (not relevant /
// competitor / wrong timing / other) so the same pair isn't re-surfaced on the
// next scan. A disposition is optimistically hidden here and persisted via
// dismissIntro; a failed write simply reappears on the next Rescan.

const pairKey = (p: ProactivePairing) => `${p.companyAId}|${p.companyBId}`;

export function IntroScan({
  initial,
}: {
  initial: ProactiveCacheSnapshot | null;
}) {
  // Last-known-good scan (seeded from the cache). A rescan only supersedes it on
  // success — a transient AI failure must never wipe a useful cached view; errors
  // surface alongside it, not over it.
  const [snapshot, setSnapshot] = useState<ProactivePairing[] | null>(
    initial ? initial.pairings : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<number | null>(
    initial ? Date.parse(initial.generatedAt) : null,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  // Wall clock captured on mount (never during render — that would be impure and
  // could disagree with the server-rendered HTML on hydration). Drives the
  // relative "updated Xm ago" label and the client-side staleness check.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNowMs(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const run = useCallback(() => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("scope", "members");
      const next = await scanNetworkIntros({ status: "idle" }, fd);
      if (next.status === "ok") {
        setSnapshot(next.pairings);
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
  }, []);

  const visible = snapshot
    ? snapshot.filter((p) => !dismissed.has(pairKey(p)))
    : [];
  const stale =
    analyzedAt !== null &&
    nowMs !== null &&
    !isProactiveCacheFresh(new Date(analyzedAt), nowMs);

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
            Possible Introductions
          </span>
          {snapshot && nowMs !== null && analyzedAt !== null ? (
            <span
              className={cn("text-[10px]", stale ? "text-gold-ink" : "text-ink-3")}
            >
              updated {relativeAge(analyzedAt, nowMs)}
              {stale ? " · rescan for the latest" : ""}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="gold" disabled={pending} onClick={run}>
          {pending ? "Scanning…" : snapshot ? "Rescan" : "Scan network"}
        </Button>
      </div>
      <div className="p-4">
        {/* Errors show alongside — never replacing — the last good scan. */}
        {error !== null ? (
          <p className="mb-2 text-[11px] text-red-ink">{error}</p>
        ) : null}

        {visible.length > 0 ? (
          <ul className="grid max-h-[28rem] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
            {visible.map((p) => (
              <PairingCard
                key={pairKey(p)}
                p={p}
                onDismiss={(key) =>
                  setDismissed((prev) => new Set(prev).add(key))
                }
              />
            ))}
          </ul>
        ) : pending ? (
          <div className="flex items-center gap-2.5">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-2 border-t-gold" />
            <span className="text-[11px] text-ink-2">
              Scanning the network… this can take up to a minute.
            </span>
          </div>
        ) : snapshot ? (
          <p className="text-[11px] text-ink-3 italic">
            No new introductions surfaced right now.
          </p>
        ) : error !== null ? null : (
          <p className="text-[11px] text-ink-3">
            Scan the network for the highest-value introductions to make right
            now.
          </p>
        )}
      </div>
    </div>
  );
}

function PairingCard({
  p,
  onDismiss,
}: {
  p: ProactivePairing;
  onDismiss: (key: string) => void;
}) {
  const [isDismissing, startDismiss] = useTransition();
  const logHref = `/dashboard/introductions?logCompanyA=${p.companyAId}&logCompanyB=${p.companyBId}&logText=${encodeURIComponent(p.headline)}#log-intro`;
  const timeSensitive = p.urgencyTrigger !== "" || p.window !== "";

  function dispose(reason: string) {
    // Optimistically hide, then persist. A failed write just reappears on the
    // next Rescan (which re-queries the DB and already excludes it).
    onDismiss(pairKey(p));
    startDismiss(async () => {
      await dismissIntro(p.companyAId, p.companyBId, reason);
    });
  }

  return (
    <li
      className={cn(
        "rounded-md border border-line bg-surface-2 px-3.5 py-3",
        timeSensitive && "border-l-2 border-l-gold",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[11.5px] font-semibold text-ink">
          <Link
            href={`/dashboard/companies/${p.companyAId}`}
            className="hover:underline"
          >
            {p.companyAName}
          </Link>{" "}
          <span className="text-ink-3">&#8596;</span>{" "}
          <Link
            href={`/dashboard/companies/${p.companyBId}`}
            className="hover:underline"
          >
            {p.companyBName}
          </Link>
        </div>
        <span className="shrink-0 rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold">
          {p.score}/5
        </span>
      </div>
      {timeSensitive ? (
        <UrgencyBanner trigger={p.urgencyTrigger} window={p.window} />
      ) : null}
      {p.connectionType ? (
        <div className="mt-0.5 text-[9.5px] tracking-[0.06em] text-ink-3 uppercase">
          {p.connectionType}
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] font-medium text-ink-2">{p.headline}</p>
      {p.whyNow ? (
        <p className="mt-1 text-[10.5px] text-ink-3 italic">{p.whyNow}</p>
      ) : null}
      {p.talkingPoints.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {p.talkingPoints.map((t, i) => (
            <li key={i} className="text-[10.5px] text-ink-2">
              · {t}
            </li>
          ))}
        </ul>
      ) : null}
      {p.clusterNote.trim().length > CLUSTER_NOTE_MIN ? (
        <div className="mt-1.5 overflow-hidden rounded-sm border border-teal-line">
          <ClusterNote note={p.clusterNote} />
        </div>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
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
