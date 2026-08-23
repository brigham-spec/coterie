"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui";

import { scanNetworkIntros, type ProactiveScanState } from "./actions";
import { dismissIntro } from "./companies/[id]/actions";
import { INTRO_DISMISS_REASONS } from "@/lib/intro-dismissal";
import type { ProactivePairing } from "@/lib/intro-engine";

// Dashboard Layer-0 panel (slice 11.4c) — the proactive introduction scanner. A
// client shell over the scanNetworkIntros server action, so the Anthropic key
// never crosses to the browser. Pairings are ephemeral (regenerated on demand);
// dismissals made elsewhere are already excluded server-side.
//
// Each surfaced pairing can be (a) LOGGED — deep-linked to the introductions log
// form, which resolves each company to its primary contact and seeds the two
// parties + headline — or (b) DISPOSITIONED with a reason (not relevant /
// competitor / wrong timing / other) so the same pair isn't re-surfaced on the
// next scan. A disposition is optimistically hidden here and persisted via
// dismissIntro; a failed write simply reappears on the next Rescan.

const initialState: ProactiveScanState = { status: "idle" };

const pairKey = (p: ProactivePairing) => `${p.companyAId}|${p.companyBId}`;

export function IntroScan() {
  const [state, formAction, isPending] = useActionState(
    scanNetworkIntros,
    initialState,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible =
    state.status === "ok"
      ? state.pairings.filter((p) => !dismissed.has(pairKey(p)))
      : [];

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
          Possible Introductions
        </span>
        <form action={formAction}>
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending
              ? "Scanning…"
              : state.status === "ok"
                ? "Rescan"
                : "Scan network"}
          </Button>
        </form>
      </div>
      <div className="p-4">
        {isPending ? (
          <div className="flex items-center gap-2.5">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-2 border-t-gold" />
            <span className="text-[11px] text-ink-2">
              Scanning the network… this can take up to a minute.
            </span>
          </div>
        ) : state.status === "error" ? (
          <p className="text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          visible.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic">
              No new introductions surfaced right now.
            </p>
          ) : (
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
          )
        ) : (
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

  function dispose(reason: string) {
    // Optimistically hide, then persist. A failed write just reappears on the
    // next Rescan (which re-queries the DB and already excludes it).
    onDismiss(pairKey(p));
    startDismiss(async () => {
      await dismissIntro(p.companyAId, p.companyBId, reason);
    });
  }

  return (
    <li className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
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
