"use client";

import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { deleteEvent } from "../actions";

// Two-step-confirm event delete (mirrors the project/company danger zone). The
// server action removes the event — its guest list and logged conversions cascade
// at the DB, linked action items and introductions detach — then redirects to the
// directory.
export function DeleteEvent({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader title="Danger zone" />
      <div className="px-4 py-3">
        {confirming ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-ink-2">
              Permanently delete{" "}
              <span className="font-medium">{eventName}</span> and its guest list
              and logged conversions? This cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <form action={deleteEvent}>
                <input type="hidden" name="eventId" value={eventId} />
                <Button type="submit" variant="danger">
                  Delete permanently
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Delete event
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
