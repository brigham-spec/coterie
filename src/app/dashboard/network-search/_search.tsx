"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button, Card } from "@/components/ui";

import { searchNetwork, type NetworkSearchState } from "./actions";
import type { NetworkSearchMatch } from "@/lib/network-search";

// Network Search UI (slice 11.5). A client shell over the searchNetwork server
// action (so the Anthropic key stays server-side). The textarea holds the plain-
// English query; example chips dispatch the action directly with a preset query
// (formAction(FormData) — no controlled-input round-trip). Results are ephemeral,
// re-rendered each search.

const initialState: NetworkSearchState = { status: "idle" };

const EXAMPLES = [
  "Who has IDA / PILOT financing experience?",
  "Who is looking for a capital partner?",
  "Who does hospitality development?",
  "Who has Dutchess County projects?",
  "Who can help with land use permitting?",
];

export function NetworkSearch() {
  const [state, formAction, isPending] = useActionState(
    searchNetwork,
    initialState,
  );

  function runExample(query: string) {
    const fd = new FormData();
    fd.set("query", query);
    formAction(fd);
  }

  return (
    <div className="mt-4">
      <Card>
        <form action={formAction} className="p-4">
          <textarea
            name="query"
            rows={2}
            required
            disabled={isPending}
            placeholder="e.g. Who has experience with adaptive-reuse projects in Newburgh?"
            className="w-full resize-none rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[10px] text-ink-3">
              Searches your active network. Results are grounded in your own data.
            </p>
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending ? "Searching…" : "Search"}
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface-2 px-4 py-3">
          <span className="mr-1 self-center text-[10px] text-ink-3">Try:</span>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => runExample(q)}
              disabled={isPending}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2 transition-colors hover:border-gold-line hover:text-gold disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </Card>

      {isPending ? (
        <p className="text-[11px] text-ink-3 italic">Searching the network…</p>
      ) : state.status === "error" ? (
        <p className="text-[11px] text-red-ink">{state.message}</p>
      ) : state.status === "ok" ? (
        <Results query={state.query} matches={state.matches} />
      ) : null}
    </div>
  );
}

function Results({
  query,
  matches,
}: {
  query: string;
  matches: NetworkSearchMatch[];
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {matches.length} match{matches.length === 1 ? "" : "es"} for “{query}”
      </div>
      {matches.length === 0 ? (
        <p className="text-[11px] text-ink-3 italic">
          No companies in your network matched that. Try rephrasing.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {matches.map((m) => (
            <MatchCard key={m.companyId} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchCard({ m }: { m: NetworkSearchMatch }) {
  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/companies/${m.companyId}`}
            className="text-[12px] font-semibold text-ink hover:underline"
          >
            {m.companyName}
          </Link>
          {m.contactName ? (
            <span className="ml-1.5 text-[11px] text-ink-3">
              · {m.contactName}
            </span>
          ) : null}
        </div>
        <RelevancePips relevance={m.relevance} />
      </div>
      {m.why ? <p className="mt-1.5 text-[11px] text-ink-2">{m.why}</p> : null}
      {m.keyDetail ? (
        <p className="mt-1.5 text-[10.5px] text-gold">{m.keyDetail}</p>
      ) : null}
    </li>
  );
}

function RelevancePips({ relevance }: { relevance: number }) {
  return (
    <span
      className="flex shrink-0 items-center gap-0.5"
      title={`Relevance ${relevance}/5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={
            n <= relevance
              ? "h-1.5 w-1.5 rounded-full bg-gold"
              : "h-1.5 w-1.5 rounded-full bg-line-2"
          }
        />
      ))}
    </span>
  );
}
