"use client";

import { useState } from "react";

import { deleteEvent } from "./actions";

// Compact per-row event delete for the events directory table. Same two-step
// confirm as the detail-page danger zone, but sized to sit in a table cell.
// The server action (admin-gated) removes the event and revalidates the list.
export function DeleteEventRow({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
        >
          Cancel
        </button>
        <form action={deleteEvent}>
          <input type="hidden" name="eventId" value={eventId} />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
          >
            Confirm
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${eventName}`}
        className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:text-red hover:underline"
      >
        Delete
      </button>
    </div>
  );
}
