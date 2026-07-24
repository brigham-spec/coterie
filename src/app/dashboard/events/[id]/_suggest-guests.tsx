"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { suggestGuestList, type SuggestGuestsState } from "../actions";

// AI guest-list curation (ported from the prototype's "AI Suggest Guest List").
// A client shell over the suggestGuestList server action, so the Anthropic key
// never crosses to the browser. Unlike the brief/outreach panels this one WRITES:
// each pick is added to the guest list with its reason stored as a note, and the
// page revalidates to show the new invitees. Re-run to top up the list.

const initialState: SuggestGuestsState = { status: "idle" };

export function SuggestGuests({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(
    suggestGuestList,
    initialState,
  );

  return (
    <Card>
      <CardHeader title="AI guest suggestions" />
      <div className="p-4">
        <p className="mb-3 text-[11px] text-ink-3">
          Curate the guest list from your network. Claude picks members who fit
          this event&apos;s theme — prioritising those never invited before — and
          adds them with a one-line reason.
        </p>
        <form action={formAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending ? "Curating…" : "Suggest guests"}
          </Button>
        </form>

        {isPending ? null : state.status === "error" ? (
          <p className="mt-3 text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "empty" ? (
          <p className="mt-3 text-[11px] text-ink-3 italic">
            No new guests to suggest — everyone who fits is already invited.
          </p>
        ) : state.status === "ok" ? (
          <p className="mt-3 text-[11px] text-teal-ink">
            Added {state.added} {state.added === 1 ? "guest" : "guests"} to the
            list.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
