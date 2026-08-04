"use client";

import { useState, useTransition } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import {
  MeetingActionItems,
  type NetworkOption,
  type OwnerOption,
  type PersistedItem,
} from "../../meetings/_action-items";

import {
  logMeeting,
  deleteMeeting,
  importFirefliesTranscript,
  loadFirefliesForCompany,
} from "./actions";

// Interactive meetings (profile-parity port of the prototype's "Log Meeting").
// Production meetings otherwise arrive only from the org-level Fireflies sync;
// this card lets staff record one directly on the profile. A meeting surfaces
// here through its attendees, so the form requires selecting at least one
// contact of this company. Only manual meetings can be removed (synced ones
// would return on the next sync). This holds just local UI state; writes go
// through the withOrg-scoped meeting actions, which revalidate.

// Pin to UTC so a date-only meeting shows the same calendar day here (this card
// renders client-side, in the browser's timezone) as it does in the server-
// rendered relationship timeline on the profile page — otherwise a UTC-midnight
// heldAt reads a day earlier in western browsers. Matches the commitments view.
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

type Contact = { id: string; name: string };

export type MeetingRow = {
  id: string;
  title: string;
  heldAt: Date;
  summary: string | null;
  durationMinutes: number | null;
  location: string | null;
  isManual: boolean;
  attendeeNames: string[];
  // All matched attendees (any company) — owner candidates for action items.
  attendees: OwnerOption[];
  actionItems: PersistedItem[];
};

export function MeetingsCard({
  companyId,
  meetings,
  contacts,
  staff,
  networkContacts,
  firefliesConnected,
}: {
  companyId: string;
  meetings: MeetingRow[];
  contacts: Contact[];
  staff: OwnerOption[];
  networkContacts: NetworkOption[];
  firefliesConnected: boolean;
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

      {firefliesConnected ? <FirefliesImport companyId={companyId} /> : null}

      {meetings.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          {canLog
            ? "No meetings recorded with this company yet."
            : "Add a contact before logging a meeting."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {meetings.map((m) => (
            <MeetingItem
              key={m.id}
              companyId={companyId}
              meeting={m}
              staff={staff}
              networkContacts={networkContacts}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

// Pull-from-Fireflies affordances (Members audit items 7 + 8), shown only when
// the org has connected Fireflies. "Import" fetches the one pasted transcript;
// "Load recent" pulls the recent transcripts that mention this company. Both run
// the same server-side reconcile and surface on this profile via matched
// attendees, and share one inline message. The paste input is CONTROLLED so React
// 19's post-action form reset doesn't wipe what was typed on an error return, and
// so it can be cleared on success.
function FirefliesImport({ companyId }: { companyId: string }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, start] = useTransition();

  function loadRecent() {
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      const result = await loadFirefliesForCompany(fd);
      setMsg({ ok: result.status === "saved", text: result.message });
    });
  }

  return (
    <div className="border-b border-line p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          Import from Fireflies
        </span>
        <button
          type="button"
          onClick={loadRecent}
          disabled={loading}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load recent"}
        </button>
      </div>
      <form
        action={async (fd) => {
          const result = await importFirefliesTranscript(fd);
          setMsg({ ok: result.status === "saved", text: result.message });
          if (result.status === "saved") setValue("");
        }}
      >
        <input type="hidden" name="companyId" value={companyId} />
        <div className="flex gap-2">
          <input
            type="text"
            name="transcriptId"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a Fireflies transcript ID or link…"
            className="min-w-0 flex-1 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-line"
          />
          <Button type="submit" variant="primary">
            Import
          </Button>
        </div>
      </form>
      {msg ? (
        <p className={`mt-1.5 text-xs ${msg.ok ? "text-teal-ink" : "text-red-ink"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

function MeetingItem({
  companyId,
  meeting,
  staff,
  networkContacts,
}: {
  companyId: string;
  meeting: MeetingRow;
  staff: OwnerOption[];
  networkContacts: NetworkOption[];
}) {
  // Cross-attribution pool for this meeting: every network contact who wasn't a
  // matched attendee, so an item mentioning an absent member can be owned by them.
  const attendeeIds = new Set(meeting.attendees.map((a) => a.id));
  const networkOptions = networkContacts.filter((c) => !attendeeIds.has(c.id));

  return (
    <li className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-ink">{meeting.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-3">
            <span>{dateFmt.format(meeting.heldAt)}</span>
            {meeting.durationMinutes != null ? (
              <span>· {meeting.durationMinutes} min</span>
            ) : null}
            {meeting.location ? <span>· {meeting.location}</span> : null}
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

      <MeetingActionItems
        meetingId={meeting.id}
        staffOptions={staff}
        attendeeOptions={meeting.attendees}
        networkOptions={networkOptions}
        items={meeting.actionItems}
      />
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
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        const result = await logMeeting(fd);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-2 gap-4">
        <Field name="title" label="Meeting title" className="col-span-2" required />
        <Field name="heldAt" label="Date" type="date" />
        <Field
          name="durationMinutes"
          label="Duration (minutes)"
          type="number"
          min={1}
          placeholder="e.g. 60"
        />
        <Field
          name="location"
          label="Location (optional)"
          className="col-span-2"
          placeholder="e.g. Poughkeepsie, in-person"
        />
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

      {error ? <p className="text-xs text-red-ink">{error}</p> : null}

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
