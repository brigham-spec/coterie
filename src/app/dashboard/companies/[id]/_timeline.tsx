"use client";

import { useState } from "react";

import { Button, Textarea } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { TimelineEntry } from "@/lib/relationship-timeline";

import { addNote, editNote, deleteNote } from "./actions";

// Relationship timeline (Members audit item 24) — the prototype's member-modal
// history, now merging every relationship fact (meetings, intros, delivered
// value, attended events, news, lifecycle changes) with the manual notes a user
// records here. Notes are the one editable source: each carries a noteId and
// gets inline edit/delete; the derived facts stay read-only. buildRelationship‐
// Timeline (server) does the sort/label; this renders and owns the note forms.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// A Date → the YYYY-MM-DD an <input type="date"> wants, in UTC to match the
// UTC-pinned display above (so an edit reads back the same day it shows).
function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function RelationshipTimeline({
  companyId,
  entries,
}: {
  companyId: string;
  entries: TimelineEntry[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <CollapsibleCard
      id="company-timeline"
      title="Relationship timeline"
      action={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          {adding ? "Close" : "Add note"}
        </button>
      }
    >
      {adding ? (
        <div className="border-b border-line p-4">
          <NoteForm companyId={companyId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      <ol className="flex flex-col gap-0 p-4">
        {entries.map((e, idx) => (
          <TimelineRow
            key={e.noteId ?? `${e.kind}-${idx}`}
            entry={e}
            last={idx === entries.length - 1}
            companyId={companyId}
          />
        ))}
      </ol>
    </CollapsibleCard>
  );
}

function TimelineRow({
  entry,
  last,
  companyId,
}: {
  entry: TimelineEntry;
  last: boolean;
  companyId: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
        {!last ? <span className="w-px flex-1 bg-line" /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        {editing && entry.noteId ? (
          <NoteForm
            companyId={companyId}
            noteId={entry.noteId}
            initialBody={entry.label}
            initialDate={entry.date}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium whitespace-pre-wrap text-ink">
                {entry.label}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-3">
                {entry.detail ? `${entry.detail} · ` : ""}
                {dateFmt.format(entry.date)}
              </div>
            </div>
            {entry.noteId ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-[10px] text-ink-3 hover:text-gold"
                >
                  Edit
                </button>
                <form action={deleteNote}>
                  <input type="hidden" name="noteId" value={entry.noteId} />
                  <button
                    type="submit"
                    className="text-[10px] text-ink-3 hover:text-red-ink"
                  >
                    Delete
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

// Shared add/edit form. Inputs are CONTROLLED so React 19's post-action reset
// (which wipes uncontrolled fields once the action resolves) can't clear the
// typed note when the action returns an inline error and the form stays mounted.
function NoteForm({
  companyId,
  noteId,
  initialBody = "",
  initialDate,
  onDone,
}: {
  companyId: string;
  noteId?: string;
  initialBody?: string;
  initialDate?: Date;
  onDone: () => void;
}) {
  const isEdit = noteId != null;
  const [body, setBody] = useState(initialBody);
  const [date, setDate] = useState(
    toDateInput(initialDate ?? new Date()),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        const result = isEdit ? await editNote(fd) : await addNote(fd);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        onDone();
      }}
      className="flex flex-col gap-2"
    >
      {isEdit ? (
        <input type="hidden" name="noteId" value={noteId} />
      ) : (
        <input type="hidden" name="companyId" value={companyId} />
      )}
      <Textarea
        label={isEdit ? "Edit note" : "Add a note"}
        name="body"
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="A call, a hallway chat, a reminder…"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-ink-3">
          Date
          <input
            type="date"
            name="occurredAt"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-sm border border-line-2 bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-gold-line"
          />
        </label>
        <Button type="submit" variant="gold">
          {isEdit ? "Save" : "Add note"}
        </Button>
        <button
          type="button"
          onClick={onDone}
          className="text-[10px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-[11px] text-red-ink">{error}</p> : null}
    </form>
  );
}
