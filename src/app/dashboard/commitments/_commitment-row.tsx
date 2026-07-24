"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

import { editCommitment, updateCommitment } from "./actions";

// One commitment line. Open items get Done / Dismiss plus an inline text+due edit
// (parity: inline edit 13099); completed items get a single Reopen. The card is a
// client component only for the edit toggle — every mutation is a server action
// that revalidates the surface, so the form closes itself once the write lands.

export interface CommitmentRowData {
  id: string;
  text: string;
  meta: string;
  dueLabel: string;
  dueOverdue: boolean;
  dueTitle: string;
  dueDateInput: string;
}

export function CommitmentRow({
  c,
  completed = false,
}: {
  c: CommitmentRowData;
  completed?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-b border-line px-4 py-3 last:border-b-0">
        <form
          action={async (fd) => {
            await editCommitment(fd);
            setEditing(false);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="id" value={c.id} />
          <input
            name="text"
            defaultValue={c.text}
            required
            maxLength={500}
            aria-label="Commitment text"
            className="min-w-[200px] flex-1 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
          />
          <input
            name="dueDate"
            type="date"
            defaultValue={c.dueDateInput}
            aria-label="Due date"
            className="rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
          />
          <Button type="submit" variant="primary">
            Save
          </Button>
          <Button type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${completed ? "text-ink-3 line-through" : "text-ink"}`}>
          {c.text}
        </div>
        <div className="mt-0.5 text-[10px] text-ink-3">{c.meta}</div>
      </div>
      <span
        className={`flex-shrink-0 self-center text-right text-[10px] whitespace-nowrap ${
          c.dueOverdue ? "font-semibold text-red-ink" : "text-ink-3"
        }`}
        title={c.dueTitle || undefined}
      >
        {c.dueLabel}
      </span>
      <div className="flex flex-shrink-0 gap-1.5">
        {completed ? (
          <form action={updateCommitment}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="open" />
            <Button type="submit">Reopen</Button>
          </form>
        ) : (
          <>
            <form action={updateCommitment}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="status" value="done" />
              <Button type="submit" variant="primary">
                Done
              </Button>
            </form>
            <form action={updateCommitment}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="status" value="dropped" />
              <Button type="submit">Dismiss</Button>
            </form>
            <Button type="button" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
