"use client";

import { useActionState, useState, useTransition } from "react";

import { Button, Card, CardHeader } from "@/components/ui";
import type { TargetEdgeType, TargetSuggestion } from "@/lib/event-targets";

import { addInvitee, findEventTargets, type FindTargetsState } from "../actions";

// Find-Targets panel (slice S10b, ported from the prototype's target-suggestions
// UI). A client shell over the findEventTargets read action: on "Find targets" it
// scans the relationship graph and lists network companies connected to the
// current guests, each with the reasons (intro / shared project / referral) as
// chips. "Add" invites the company's lead contact through the normal addInvitee
// flow (which revalidates the page, seeding a new outreach row); "Dismiss" hides a
// suggestion locally for this pass. State that survives a page revalidation —
// the scan result and the added/dismissed sets — lives here so an RSVP change
// elsewhere on the page doesn't wipe it.

const initialState: FindTargetsState = { status: "idle" };

// Full class strings per edge type (Tailwind JIT needs literals, never built).
const EDGE_CLASS: Record<TargetEdgeType, string> = {
  intro: "bg-teal-bg text-teal-ink",
  project: "bg-gold-bg text-gold-ink",
  referral: "bg-surface text-ink-3 border border-line-2",
};

export function FindTargets({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(
    findEventTargets,
    initialState,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  const suggestions =
    state.status === "ok"
      ? state.suggestions.filter((s) => !dismissed.has(s.companyId))
      : [];

  return (
    <Card>
      <CardHeader
        title="Find targets"
        action={
          <form action={formAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              disabled={isPending}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
            >
              {isPending
                ? "Scanning…"
                : state.status === "idle"
                  ? "Find targets"
                  : "Rescan"}
            </button>
          </form>
        }
      />

      <div className="p-4">
        {state.status === "idle" ? (
          <p className="text-[11px] text-ink-3">
            Scan your current guest list for network companies connected to those
            guests — through an introduction, a shared project, or a referral —
            worth inviting too.
          </p>
        ) : state.status === "error" ? (
          <p className="text-[11px] text-red-ink">{state.message}</p>
        ) : state.guestCount === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            Add a network guest to the list first — connections are found through
            who&apos;s already coming.
          </p>
        ) : suggestions.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            No new connections found among your {state.guestCount} guest
            {state.guestCount === 1 ? "" : "s"} — try adding more guests first.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-ink-3">
              {suggestions.length} suggested based on {state.guestCount} current
              guest{state.guestCount === 1 ? "" : "s"}.
            </p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <TargetRow
                  key={s.companyId}
                  eventId={eventId}
                  suggestion={s}
                  added={added.has(s.companyId)}
                  onAdded={() =>
                    setAdded((prev) => new Set(prev).add(s.companyId))
                  }
                  onDismiss={() =>
                    setDismissed((prev) => new Set(prev).add(s.companyId))
                  }
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function TargetRow({
  eventId,
  suggestion,
  added,
  onAdded,
  onDismiss,
}: {
  eventId: string;
  suggestion: Omit<TargetSuggestion, "strength">;
  added: boolean;
  onAdded: () => void;
  onDismiss: () => void;
}) {
  const [isAdding, startAdd] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-ink">
          {suggestion.org ?? suggestion.name}
          {suggestion.org && suggestion.org !== suggestion.name ? (
            <span className="ml-1.5 text-[10px] font-normal text-ink-3">
              · {suggestion.name}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestion.edges.map((e, i) => (
            <span
              key={`${e.type}-${i}`}
              className={`rounded-full px-2 py-0.5 text-[9.5px] ${EDGE_CLASS[e.type]}`}
            >
              {e.label}
            </span>
          ))}
        </div>
        {error ? (
          <p className="mt-1 text-[10px] text-red-ink">{error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Button
          type="button"
          disabled={isAdding || added}
          onClick={() =>
            startAdd(async () => {
              setError(null);
              const fd = new FormData();
              fd.set("eventId", eventId);
              fd.set("contactId", suggestion.contactId);
              try {
                await addInvitee(fd);
                onAdded();
              } catch {
                setError("Could not add this guest.");
              }
            })
          }
        >
          {added ? "Added" : isAdding ? "Adding…" : "Add"}
        </Button>
        {added ? null : (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] text-ink-3 hover:text-ink"
          >
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}
