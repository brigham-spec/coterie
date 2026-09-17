"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader, Textarea } from "@/components/ui";

import { generateBrief, updateGuestBrief, type GuestBriefState } from "../actions";

// Guest-brief panel (slice 11.7) on the event detail page. A client shell over the
// generateBrief server action, so the Anthropic key never crosses to the browser.
// It briefs the attending guests (Confirmed / Attended) who have a member profile —
// the host's crib sheet for who's in the room. Briefs are now SAVED to each invitee
// (event_invitees.brief) and editable here: "Write guest briefs" generates + persists
// all of them, and each row's textarea lets the host refine one and Save it.

// One attending guest with their saved brief, supplied by the event page.
export type BriefGuest = {
  inviteeId: string;
  name: string;
  org: string | null;
  brief: string;
};

const initialState: GuestBriefState = { status: "idle" };

export function GuestBrief({
  eventId,
  guests,
}: {
  eventId: string;
  guests: BriefGuest[];
}) {
  const [state, formAction, isPending] = useActionState(
    generateBrief,
    initialState,
  );
  const anyBrief = guests.some((g) => g.brief.trim() !== "");

  return (
    <Card>
      <CardHeader
        title="Guest brief"
        action={
          guests.length > 0 ? (
            <form action={formAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <Button type="submit" variant="gold" disabled={isPending}>
                {isPending
                  ? "Writing briefs…"
                  : anyBrief
                    ? "Rewrite all briefs"
                    : "Write guest briefs"}
              </Button>
            </form>
          ) : undefined
        }
      />
      <div className="p-4">
        <p className="mb-3 text-[11px] text-ink-3">
          A short bio for each confirmed guest from the network — a crib sheet
          for who&apos;s in the room. Generate them, then edit any before sharing.
        </p>

        {state.status === "error" ? (
          <p className="mb-3 text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "empty" ? (
          <p className="mb-3 text-[11px] text-ink-3 italic">
            No brief could be written yet — confirm a member guest, then try again.
          </p>
        ) : null}

        {guests.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            No confirmed guests from the network yet. Confirm a member guest to
            brief them.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {guests.map((g) => (
              <BriefRow key={g.inviteeId} eventId={eventId} guest={g} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function BriefRow({
  eventId,
  guest,
}: {
  eventId: string;
  guest: BriefGuest;
}) {
  return (
    <li className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
      <form action={updateGuestBrief}>
        <input type="hidden" name="inviteeId" value={guest.inviteeId} />
        <input type="hidden" name="eventId" value={eventId} />
        {/* Key on the saved brief so a fresh generation resets the field. */}
        <Textarea
          key={guest.brief}
          name="brief"
          label={guest.org ? `${guest.name} · ${guest.org}` : guest.name}
          defaultValue={guest.brief}
          rows={3}
          placeholder="Write a short bio, or use “Write guest briefs” above."
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </li>
  );
}
