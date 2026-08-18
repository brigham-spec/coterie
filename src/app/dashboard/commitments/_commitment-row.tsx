"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui";

import {
  draftNudgeEmail,
  editCommitment,
  updateCommitment,
  type NudgeEmailState,
} from "./actions";

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
  // Cross-links (parity: 13157) prefilled via the URL. Search always applies;
  // the intro links are null unless the item carries a contact/company.
  searchHref: string;
  connectHref: string | null;
  logIntroHref: string | null;
  // Only "they owe" items carry a contact to nudge; a we-owe item has no
  // recipient, so the "Draft nudge" toggle is hidden for those.
  canNudge: boolean;
  // Reviewable note left when the item was marked done; null otherwise. Shown
  // under the row on the completed ledger.
  completionNote: string | null;
}

const initialNudge: NudgeEmailState = { status: "idle" };

export function CommitmentRow({
  c,
  completed = false,
  selection,
}: {
  c: CommitmentRowData;
  completed?: boolean;
  // When set, the row is in bulk-select mode: it shows a checkbox and hides the
  // inline edit + per-row actions (the batch bar drives the mutation instead).
  selection?: { checked: boolean; onToggle: () => void };
}) {
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudge, nudgeAction, nudgePending] = useActionState(
    draftNudgeEmail,
    initialNudge,
  );

  // Marking done opens an optional completion-note step (parity: reviewable
  // resolution) — the note rides along on the same updateCommitment write, so
  // the reviewer sees how the follow-up was closed on the completed ledger.
  if (noting) {
    return (
      <li className="border-b border-line px-4 py-3 last:border-b-0">
        <form
          action={async (fd) => {
            await updateCommitment(fd);
            setNoting(false);
          }}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="status" value="done" />
          <div className="text-[13px] text-ink">{c.text}</div>
          <textarea
            name="note"
            rows={2}
            maxLength={1000}
            placeholder="Add a note about how this was resolved (optional)"
            aria-label="Completion note"
            className="w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Complete
            </Button>
            <Button type="button" onClick={() => setNoting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

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
      {selection ? (
        <input
          type="checkbox"
          checked={selection.checked}
          onChange={selection.onToggle}
          aria-label={`Select "${c.text}"`}
          className="mt-0.5 accent-gold"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${completed ? "text-ink-3 line-through" : "text-ink"}`}>
          {c.text}
        </div>
        <div className="mt-0.5 text-[10px] text-ink-3">{c.meta}</div>
        {completed && c.completionNote ? (
          <p className="mt-1.5 rounded-md border border-line bg-surface-2 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
            {c.completionNote}
          </p>
        ) : null}
        {!completed && !selection ? (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <CrossLink href={c.searchHref}>Search network</CrossLink>
            {c.connectHref ? (
              <CrossLink href={c.connectHref}>Connections</CrossLink>
            ) : null}
            {c.logIntroHref ? (
              <CrossLink href={c.logIntroHref}>Log intro</CrossLink>
            ) : null}
            {c.canNudge ? (
              <button
                type="button"
                onClick={() => setNudging((v) => !v)}
                className="text-[10px] font-medium text-ink-3 underline-offset-2 hover:text-gold-ink hover:underline"
              >
                {nudging ? "Hide nudge" : "Draft nudge"}
              </button>
            ) : null}
          </div>
        ) : null}
        {!completed && !selection && c.canNudge && nudging ? (
          <div className="mt-2">
            <form action={nudgeAction}>
              <input type="hidden" name="id" value={c.id} />
              <Button type="submit" variant="gold" disabled={nudgePending}>
                {nudgePending
                  ? "Drafting…"
                  : nudge.status === "ok"
                    ? "Redraft nudge"
                    : "Draft nudge email"}
              </Button>
            </form>
            {nudge.status === "error" ? (
              <p className="mt-2 text-[11px] text-red-ink">{nudge.message}</p>
            ) : nudge.status === "ok" ? (
              <p className="mt-2 rounded-md border border-line bg-surface-2 p-3.5 text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
                {nudge.draft.body}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <span
        className={`flex-shrink-0 self-center text-right text-[10px] whitespace-nowrap ${
          c.dueOverdue ? "font-semibold text-red-ink" : "text-ink-3"
        }`}
        title={c.dueTitle || undefined}
      >
        {c.dueLabel}
      </span>
      {selection ? null : (
        <div className="flex flex-shrink-0 gap-1.5">
          {completed ? (
            <form action={updateCommitment}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="status" value="open" />
              <Button type="submit">Reopen</Button>
            </form>
          ) : (
            <>
              <Button
                type="button"
                variant="primary"
                onClick={() => setNoting(true)}
              >
                Done
              </Button>
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
      )}
    </li>
  );
}

function CrossLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-[10px] font-medium text-ink-3 underline-offset-2 hover:text-gold-ink hover:underline"
    >
      {children}
    </Link>
  );
}
