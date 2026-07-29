"use client";

import { useMemo, useState } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import { logManualMeeting } from "./actions";

// Global "+ Log Meeting" (Meet audit item 7). Production meetings otherwise
// arrive only from the org-level Fireflies sync or the per-company profile log;
// this records one across the whole network, selecting attendees from ANY
// contact in the org via a searchable multi-select. Local UI state only; the
// write goes through the withOrg-scoped logManualMeeting, which revalidates.

type Contact = { id: string; name: string; company: string };

export function LogMeeting({ contacts }: { contacts: Contact[] }) {
  const [open, setOpen] = useState(false);
  const canLog = contacts.length > 0;

  return (
    <Card>
      <CardHeader
        title="Log a meeting"
        action={
          canLog ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {open ? "Close" : "Log meeting"}
            </button>
          ) : null
        }
      />
      {open ? (
        <div className="p-4">
          <LogMeetingForm contacts={contacts} onDone={() => setOpen(false)} />
        </div>
      ) : (
        <p className="px-4 py-4 text-xs text-ink-3">
          {canLog
            ? "Record a meeting held outside Fireflies. Attendees can be any contact in your network."
            : "Add a contact before logging a meeting."}
        </p>
      )}
    </Card>
  );
}

function LogMeetingForm({
  contacts,
  onDone,
}: {
  contacts: Contact[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const chosen = contacts.filter((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form
      action={async (fd) => {
        const result = await logManualMeeting(fd);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      {/* Selected attendees ride along as repeated fields the action reads via
          getAll — the filtered checkbox list below is UI-only. */}
      {chosen.map((c) => (
        <input key={c.id} type="hidden" name="attendeeIds" value={c.id} />
      ))}

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
        {chosen.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chosen.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className="flex items-center gap-1 rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-medium text-teal-ink hover:underline"
                aria-label={`Remove ${c.name}`}
              >
                {c.name}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        ) : null}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter contacts…"
          className="mb-2 w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-line"
        />
        <div className="max-h-48 overflow-y-auto rounded-sm border border-line">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-ink-3">No matches.</p>
          ) : (
            filtered.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-xs last:border-b-0 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="accent-gold"
                />
                <span className="truncate text-ink">{c.name}</span>
                <span className="truncate text-ink-3">· {c.company}</span>
              </label>
            ))
          )}
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
