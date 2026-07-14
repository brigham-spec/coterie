"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { draftOutreach, type OutreachState } from "../actions";

// Outreach-draft panel (gap-audit cluster D) on the event detail page. A client
// shell over the draftOutreach server action, so the Anthropic key never crosses
// to the browser. Pick an invited guest from the network and it writes a personal
// invitation email from the host to them, grounded in that guest's profile and
// recent activity. The draft is ephemeral: edit it, copy it, send it — nothing is
// stored.

const initialState: OutreachState = { status: "idle" };

export function Outreach({
  eventId,
  guests,
}: {
  eventId: string;
  guests: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(draftOutreach, initialState);

  return (
    <Card>
      <CardHeader title="Draft an invitation" />
      <div className="p-4">
        {guests.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            Invite a guest from the network first, then draft a personal invitation
            email for them.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-ink-3">
              Pick an invited guest and write a personal invitation email in your
              voice — grounded in what you know about them. Edit before sending.
            </p>
            <form action={formAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="eventId" value={eventId} />
              <select
                name="inviteeId"
                defaultValue=""
                required
                className="min-w-[200px] rounded-sm border border-line-2 bg-surface px-2 py-1.5 text-[11px] text-ink outline-none focus:border-gold-line"
              >
                <option value="" disabled>
                  Select a guest…
                </option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="gold" disabled={isPending}>
                {isPending ? "Drafting…" : "Draft invitation"}
              </Button>
            </form>
          </>
        )}

        {isPending ? null : state.status === "error" ? (
          <p className="mt-3 text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          <div className="mt-4 rounded-md border border-line bg-surface-2 p-3.5">
            <div className="mb-2 text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
              To {state.guestName}
            </div>
            <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
              {state.draft}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
