"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui";

import { scanNetworkIntros, type ProactiveScanState } from "./actions";
import type { ProactivePairing } from "@/lib/intro-engine";

// Dashboard Layer-0 panel (slice 11.4c) — the proactive introduction scanner. A
// client shell over the scanNetworkIntros server action, so the Anthropic key
// never crosses to the browser. Pairings are ephemeral (regenerated on demand);
// dismissals made elsewhere are already excluded server-side.

const initialState: ProactiveScanState = { status: "idle" };

export function IntroScan() {
  const [state, formAction, isPending] = useActionState(
    scanNetworkIntros,
    initialState,
  );

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
        {state.status === "error" ? (
          <p className="text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          state.pairings.length === 0 ? (
            <p className="text-[11px] text-ink-3 italic">
              No new introductions surfaced right now.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {state.pairings.map((p) => (
                <PairingCard
                  key={`${p.companyAId}|${p.companyBId}`}
                  p={p}
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

function PairingCard({ p }: { p: ProactivePairing }) {
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
    </li>
  );
}
