"use client";

import Link from "next/link";
import { useState } from "react";

import type { EnrichmentNudge } from "@/lib/enrichment-nudge";

// Enrichment nudge card (gap-audit cluster B, prototype Coterie.html:3066).
// Chips link straight to each thin profile so the operator can fill the gaps the
// intro engine and AI briefs depend on. Naturally clears as profiles fill in —
// no dismiss state to persist. Ordered most-incomplete-first (name tiebreak) by
// buildEnrichmentNudges; a Show-all toggle reveals the long tail past the first
// batch so nothing is stranded behind a static "+N more".

const INITIAL_COUNT = 8;

export function EnrichmentNudges({ nudges }: { nudges: EnrichmentNudge[] }) {
  const [expanded, setExpanded] = useState(false);
  if (nudges.length === 0) return null;

  const shown = expanded ? nudges : nudges.slice(0, INITIAL_COUNT);
  const hidden = nudges.length - shown.length;

  return (
    <div className="mb-4 rounded-md border border-teal-line bg-teal-bg/40 px-4 py-3">
      <div className="mb-1 text-[10px] font-medium tracking-[0.07em] text-teal-ink uppercase">
        Profile Enrichment Available
      </div>
      <p className="mb-2.5 text-[11px] text-teal-ink/80">
        {nudges.length} member{nudges.length === 1 ? " has" : "s have"} thin
        profiles that weaken introductions and briefs
      </p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((n) => (
          <Link
            key={n.id}
            href={`/dashboard/companies/${n.id}`}
            className="rounded-full border border-teal-line bg-surface px-2.5 py-1 text-[10px] text-teal-ink transition-colors hover:bg-teal-bg"
          >
            <span className="font-semibold">{n.name}</span>
            <span className="text-teal-ink/70">
              {" \u00b7 missing: "}
              {n.missingFields.join(", ")}
            </span>
          </Link>
        ))}
        {nudges.length > INITIAL_COUNT ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-center rounded-full px-2 py-1 text-[10px] font-medium text-teal-ink underline-offset-2 hover:underline"
          >
            {expanded ? "Show less" : `Show all ${nudges.length} (+${hidden})`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
