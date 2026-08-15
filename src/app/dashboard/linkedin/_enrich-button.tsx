"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui";

import { triggerEnrichment, type TriggerEnrichmentState } from "./actions";

// Admin control to (re-)start the background enrichment pass over any un-enriched
// connections. The work runs in an Inngest job — this just enqueues it — so the
// button reports "queued" rather than a live result; the enriched counts refresh
// on the next page load as the job drains the backlog.

const initial: TriggerEnrichmentState = { status: "idle" };

export function EnrichButton({ pending }: { pending: number }) {
  const [state, action, submitting] = useActionState(triggerEnrichment, initial);

  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" variant="primary" disabled={submitting || pending === 0}>
        {submitting ? "Starting…" : `Run enrichment (${pending})`}
      </Button>
      {state.status === "queued" ? (
        <span className="text-[11px] text-teal-ink">
          Enrichment started — dimensions fill in as it runs.
        </span>
      ) : state.status === "error" ? (
        <span className="text-[11px] text-red-ink">{state.message}</span>
      ) : null}
    </form>
  );
}
