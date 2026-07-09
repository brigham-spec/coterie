"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { generateBrief, type GuestBriefState } from "../actions";
import type { GuestBrief as GuestBriefType } from "@/lib/event-brief";

// Guest-brief panel (slice 11.7) on the event detail page. A client shell over the
// generateBrief server action, so the Anthropic key never crosses to the browser.
// It briefs the attending guests (Confirmed / Attended) who have a CRM profile —
// the host's crib sheet for who's in the room. Results are ephemeral: re-run on
// demand; nothing is stored.

const initialState: GuestBriefState = { status: "idle" };

export function GuestBrief({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(
    generateBrief,
    initialState,
  );

  return (
    <Card>
      <CardHeader title="Guest brief" />
      <div className="p-4">
        <p className="mb-3 text-[11px] text-ink-3">
          Write a short bio for each confirmed guest from the network — a crib
          sheet for who&apos;s in the room, ready to share with attendees.
        </p>
        <form action={formAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending ? "Writing briefs…" : "Write guest briefs"}
          </Button>
        </form>

        {isPending ? null : state.status === "error" ? (
          <p className="mt-3 text-[11px] text-red-600">{state.message}</p>
        ) : state.status === "empty" ? (
          <p className="mt-3 text-[11px] text-ink-3 italic">
            No confirmed guests from the network yet. Confirm a member guest, then
            write briefs.
          </p>
        ) : state.status === "ok" ? (
          <ul className="mt-4 flex flex-col gap-2.5">
            {state.briefs.map((b) => (
              <BriefCard key={b.inviteeId} brief={b} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function BriefCard({ brief }: { brief: GuestBriefType }) {
  return (
    <li className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
      <div className="text-[11.5px] font-semibold text-ink">{brief.name}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{brief.bio}</p>
    </li>
  );
}
