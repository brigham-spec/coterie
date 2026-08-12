"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { Button, Card, TagBadge } from "@/components/ui";

import {
  searchNetwork,
  type NetworkSearchResult,
  type NetworkSearchState,
} from "./actions";
import { addCommitment } from "../companies/[id]/actions";

// Network Search UI (slice 11.5). A client shell over the searchNetwork server
// action (so the Anthropic key stays server-side). The textarea is controlled by
// `query` so an example chip both fills the box (making the search legible/
// editable) and dispatches the action with that query. Results are ephemeral,
// re-rendered each search.

const initialState: NetworkSearchState = { status: "idle" };

const EXAMPLES = [
  "Who has IDA / PILOT financing experience?",
  "Who is looking for a capital partner?",
  "Who does hospitality development?",
  "Who has Dutchess County projects?",
  "Who can help with land use permitting?",
];

export function NetworkSearch({
  initialQuery = "",
  currentUserId,
}: {
  initialQuery?: string;
  currentUserId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    searchNetwork,
    initialState,
  );
  const [query, setQuery] = useState(initialQuery);

  function runExample(example: string) {
    setQuery(example);
    const fd = new FormData();
    fd.set("query", example);
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isPending}
            onKeyDown={(e) => {
              // ⌘↵ / Ctrl+↵ submits without leaving the textarea (a plain Enter
              // is left for newlines).
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="e.g. Who has experience with adaptive-reuse projects in Newburgh?"
            className="w-full resize-none rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[10px] text-ink-3">
              Searches your active network. Results are grounded in your own data.
            </p>
            <div className="flex items-center gap-2">
              <kbd className="hidden rounded-sm border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[9px] text-ink-3 sm:inline">
                {"\u2318\u21B5"}
              </kbd>
              <Button type="submit" variant="gold" disabled={isPending}>
                {isPending ? "Searching…" : "Search"}
              </Button>
            </div>
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
        <div className="mt-4 flex items-center gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-2 border-t-gold" />
          <span className="text-[11px] text-ink-2">
            Searching the network… this can take a few seconds.
          </span>
        </div>
      ) : state.status === "error" ? (
        <p className="mt-4 text-[11px] text-red-ink">{state.message}</p>
      ) : state.status === "ok" ? (
        <div className="mt-4">
          <Results
            query={state.query}
            matches={state.matches}
            currentUserId={currentUserId}
          />
        </div>
      ) : null}
    </div>
  );
}

function Results({
  query,
  matches,
  currentUserId,
}: {
  query: string;
  matches: NetworkSearchResult[];
  currentUserId: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {matches.length} match{matches.length === 1 ? "" : "es"} for “{query}”
      </div>
      {matches.length >= 2 ? (
        <p className="mb-2 text-[10.5px] text-ink-3">
          Several companies matched —{" "}
          <Link
            href="/dashboard/introductions"
            className="text-gold hover:underline"
          >
            open the Intro Engine
          </Link>{" "}
          to connect them.
        </p>
      ) : null}
      {matches.length === 0 ? (
        <p className="text-[11px] text-ink-3 italic">
          No companies in your network matched that. Try rephrasing.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {matches.map((m) => (
            <MatchCard key={m.companyId} m={m} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchCard({
  m,
  currentUserId,
}: {
  m: NetworkSearchResult;
  currentUserId: string;
}) {
  // A "we owe" follow-up owned by the current user — reuses the company-profile
  // addCommitment writer verbatim (no new write path), like the news scan cards.
  const [taskState, setTaskState] = useState<"done" | "error" | null>(null);
  const [isTasking, startTask] = useTransition();

  // ⇄ Intro seeds the Intro Engine's Party A with this company's primary contact
  // (a deleted/absent contact falls back to the un-prefilled engine).
  const introHref = m.introContactId
    ? `/dashboard/introductions?${new URLSearchParams({ draftA: m.introContactId })}`
    : "/dashboard/introductions";

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Link
            href={`/dashboard/companies/${m.companyId}`}
            className="text-[12px] font-semibold text-ink hover:underline"
          >
            {m.companyName}
          </Link>
          {m.tier ? <TagBadge label={m.tier} tone="slate" /> : null}
          {m.contactName ? (
            <span className="text-[11px] text-ink-3">· {m.contactName}</span>
          ) : null}
        </div>
        <RelevancePips relevance={m.relevance} />
      </div>
      {m.why ? <p className="mt-1.5 text-[11px] text-ink-2">{m.why}</p> : null}
      {m.keyDetail ? (
        <p className="mt-1.5 text-[10.5px] text-gold">{m.keyDetail}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={introHref}
          className="text-[11px] text-ink-2 hover:text-gold"
        >
          {"\u21C4 Intro"}
        </Link>
        <button
          type="button"
          disabled={isTasking || taskState === "done"}
          onClick={() =>
            startTask(async () => {
              const f = new FormData();
              f.set("companyId", m.companyId);
              f.set("text", `Follow up with ${m.companyName}`);
              f.set("direction", "we_owe");
              f.set("ownerId", currentUserId);
              try {
                await addCommitment(f);
                setTaskState("done");
              } catch {
                setTaskState("error");
              }
            })
          }
          className="text-[11px] text-ink-2 hover:text-gold disabled:opacity-40"
        >
          {taskState === "done"
            ? "Action added"
            : isTasking
              ? "Adding…"
              : "+ Commitment"}
        </button>
        {taskState === "error" ? (
          <span className="text-[11px] text-red-ink">Couldn’t add</span>
        ) : null}
      </div>
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
