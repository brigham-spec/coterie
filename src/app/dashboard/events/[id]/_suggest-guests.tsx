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
          Curate the guest list from your network — members, strategic partners,
          and prospects. Claude weighs the event&apos;s theme and any linked
          project, prioritising those never invited before, and adds each with a
          one-line reason.
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
          <div className="mt-3">
            <p className="text-[11px] text-teal-ink">
              Added {state.added.length}{" "}
              {state.added.length === 1 ? "guest" : "guests"} to the list.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {state.added.map((g) => (
                <li
                  key={g.contactId}
                  className="rounded-md border border-line bg-surface px-3 py-2"
                >
                  <div className="text-xs font-medium text-ink">{g.name}</div>
                  {g.reason ? (
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      {g.reason}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
