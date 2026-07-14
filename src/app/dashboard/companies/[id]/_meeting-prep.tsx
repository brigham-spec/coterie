"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { generateMeetingPrepAction, type MeetingPrepState } from "./actions";

// Client shell for the pre-meeting brief (gap-audit cluster A). Holds only view
// state — the generation runs in the `generateMeetingPrepAction` server action, so
// the Anthropic key never crosses to the browser. The prep note is ephemeral: it
// lives in this component's action state and is regenerated on demand, never
// persisted.

const initialState: MeetingPrepState = { status: "idle" };

export function MeetingPrep({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    generateMeetingPrepAction,
    initialState,
  );

  return (
    <Card>
      <CardHeader
        title="Meeting prep"
        action={
          <form action={formAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending
                ? "Preparing…"
                : state.status === "ok"
                  ? "Refresh"
                  : "Prep me"}
            </Button>
          </form>
        }
      />
      <div className="px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-2 italic">
            {state.prep}
          </p>
        ) : (
          <p className="text-xs text-ink-3">
            Get a two-sentence prep note before your next meeting — what matters
            most right now and what was last committed.
          </p>
        )}
      </div>
    </Card>
  );
}
