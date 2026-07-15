"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import { logMeeting, deleteMeeting } from "./actions";

// Interactive meetings (profile-parity port of the prototype's "Log Meeting").
// Production meetings otherwise arrive only from the org-level Fireflies sync;
// this card lets staff record one directly on the profile. A meeting surfaces
// here through its attendees, so the form requires selecting at least one
// contact of this company. Only manual meetings can be removed (synced ones
// would return on the next sync). This holds just local UI state; writes go
// through the withOrg-scoped meeting actions, which revalidate.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type Contact = { id: string; name: string };

export type MeetingRow = {
  id: string;
  title: string;
  heldAt: Date;
  summary: string | null;
  isManual: boolean;
  attendeeNames: string[];
};

export function MeetingsCard({
  companyId,
  meetings,
  contacts,
}: {
  companyId: string;
  meetings: MeetingRow[];
  contacts: Contact[];
}) {
  const [adding, setAdding] = useState(false);
  const canLog = contacts.length > 0;

  return (
    <Card>
      <CardHeader
        title="Meetings"
        action={
          canLog ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "Log meeting"}
            </button>
          ) : null
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <MeetingForm
            companyId={companyId}
            contacts={contacts}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {meetings.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          {canLog
            ? "No meetings recorded with this company yet."
            : "Add a contact before logging a meeting."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {meetings.map((m) => (
            <MeetingItem key={m.id} companyId={companyId} meeting={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MeetingItem({
  companyId,
  meeting,
}: {
  companyId: string;
  meeting: MeetingRow;
}) {
  return (
    <li className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-ink">{meeting.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-3">
            <span>{dateFmt.format(meeting.heldAt)}</span>
            {meeting.attendeeNames.length > 0 ? (
              <span>· {meeting.attendeeNames.join(", ")}</span>
            ) : null}
            {meeting.isManual ? <span>· Manual</span> : null}
          </div>
        </div>
        {meeting.isManual ? (
          <form action={deleteMeeting} className="shrink-0">
            <input type="hidden" name="id" value={meeting.id} />
            <input type="hidden" name="companyId" value={companyId} />
            <button
              type="submit"
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Remove
            </button>
          </form>
        ) : null}
      </div>
      {meeting.summary ? (
        <p className="text-xs whitespace-pre-wrap text-ink-2">{meeting.summary}</p>
      ) : null}
    </li>
  );
}

function MeetingForm({
  companyId,
  contacts,
  onDone,
}: {
  companyId: string;
  contacts: Contact[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await logMeeting(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-2 gap-4">
        <Field name="title" label="Meeting title" className="col-span-2" required />
        <Field name="heldAt" label="Date" type="date" />
      </div>

      <fieldset>
        <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          Attendees
        </span>
        <div className="flex flex-col gap-1.5">
          {contacts.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                name="attendeeIds"
                value={c.id}
                className="accent-gold"
              />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>

      <Textarea name="summary" label="Summary / notes" />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Log meeting
        </Button>
      </div>
    </form>
  );
}
