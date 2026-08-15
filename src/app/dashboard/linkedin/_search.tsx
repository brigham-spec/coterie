"use client";

import { useActionState } from "react";

import { Button, TagBadge } from "@/components/ui";
import {
  FIELD_META,
  inferredBadge,
  type LinkedinSearchField,
  type LinkedinSearchHit,
  type LinkedinSearchRow,
} from "@/lib/linkedin-search";

import {
  promoteLinkedinContact,
  searchLinkedin,
  type LinkedinSearchState,
  type PromoteState,
} from "./actions";

// Recall search (step 3): the tenant asks "who do I know that does X" in plain
// English and gets back the enriched connections whose stated + inferred fields
// best match. Deterministic by design (see linkedin-search.ts), so every result
// can show its OWN provenance — this UI marks which fields matched and, for the
// three inferred dimensions, whether the match landed on an inference (with its
// high/low confidence grade) rather than a stated fact. A match on a guessed
// dimension never reads the same as a match on a verbatim one.

const initial: LinkedinSearchState = { status: "idle" };
const promoteInitial: PromoteState = { status: "idle" };

// Turn a recalled connection into a real network Contact (step 4). Shows a link
// to the new contact once promoted — either from a prior promotion (the row
// already carries promotedContactId) or from this session's action result. A
// person can only be promoted once; after that the button becomes that link.
function PromoteControl({ row }: { row: LinkedinSearchRow }) {
  const [state, action, pending] = useActionState(
    promoteLinkedinContact,
    promoteInitial,
  );

  const promotedId =
    state.status === "ok" ? state.contactId : row.promotedContactId;
  if (promotedId) {
    return (
      <a
        href={`/dashboard/contacts/${promotedId}`}
        className="text-[11px] font-medium text-gold hover:underline"
      >
        View contact →
      </a>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="linkedinContactId" value={row.id} />
      <Button type="submit" variant="default" disabled={pending}>
        {pending ? "Promoting…" : "Promote to contact"}
      </Button>
      {state.status === "error" ? (
        <span className="text-[11px] text-red-ink">{state.message}</span>
      ) : null}
    </form>
  );
}

function MatchBadge({
  field,
  row,
}: {
  field: LinkedinSearchField;
  row: LinkedinSearchRow;
}) {
  const { label, confidenceKey } = FIELD_META[field];
  // An inferred dimension names its confidence column; a match there lands on a
  // GUESS, so its badge carries the "inferred" marker + grade. Stated fields don't.
  if (confidenceKey) {
    const badge = inferredBadge(row[confidenceKey]);
    return (
      <TagBadge
        label={`${label} · ${badge.label}`}
        tone={badge.tone}
        title="Matched an inferred dimension, not a stated fact"
      />
    );
  }
  return (
    <TagBadge label={label} tone="gold" title="Matched a stated field" />
  );
}

function HitCard({ hit }: { hit: LinkedinSearchHit }) {
  const { row, matched } = hit;
  const subtitle = [row.title, row.company].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          {row.profileUrl ? (
            <a
              href={row.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {row.fullName}
            </a>
          ) : (
            row.fullName
          )}
        </span>
        {subtitle ? (
          <span className="text-xs text-ink-2">{subtitle}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-ink-3">matched on</span>
          {matched.map((field) => (
            <MatchBadge key={field} field={field} row={row} />
          ))}
        </div>
        <PromoteControl row={row} />
      </div>
    </li>
  );
}

export function SearchPanel() {
  const [state, action, pending] = useActionState(searchLinkedin, initial);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex items-end gap-3">
        <label className="block flex-1">
          <span className="mb-1 block text-[11px] font-medium tracking-[0.04em] text-ink-2 uppercase">
            Who do you know that…
          </span>
          <input
            name="query"
            placeholder="e.g. works in finance, or a VP of engineering"
            className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-gold-line focus:ring-2 focus:ring-gold-line/20 focus:outline-none"
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>

      {state.status === "error" ? (
        <p className="text-xs text-red-ink">{state.message}</p>
      ) : state.status === "ok" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-2">
            {state.hits.length === 0 ? (
              <>
                No enriched connections matched{" "}
                <strong className="text-ink">
                  &ldquo;{state.query}&rdquo;
                </strong>
                {state.searched === 0
                  ? " — enrich your connections first, then search."
                  : ` across ${state.searched} enriched connection${
                      state.searched === 1 ? "" : "s"
                    }.`}
              </>
            ) : (
              <>
                <strong className="text-ink">{state.hits.length}</strong> match
                {state.hits.length === 1 ? "" : "es"} for{" "}
                <strong className="text-ink">
                  &ldquo;{state.query}&rdquo;
                </strong>{" "}
                across {state.searched} enriched connection
                {state.searched === 1 ? "" : "s"}.
              </>
            )}
          </p>
          {state.hits.length > 0 ? (
            <ul className="overflow-hidden rounded-sm border border-line">
              {state.hits.map((hit) => (
                <HitCard key={hit.row.id} hit={hit} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">
          Search across your enriched connections by industry, role, seniority,
          company, or name. Matches on an inferred dimension are marked as such,
          with their confidence — an inference never reads as a stated fact.
        </p>
      )}
    </div>
  );
}
