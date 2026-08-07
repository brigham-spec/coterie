"use client";

import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { batchUpdateCommitments } from "./actions";
import { CommitmentRow, type CommitmentRowData } from "./_commitment-row";

// A commitment section that can enter a bulk-select mode (parity: select mode +
// batch done/delete, Coterie.html:5726). Selection state lives here: each row
// shows a checkbox while selecting, and the footer bar resolves or deletes the
// whole checked set in one server write. Delete is two-step. A successful batch
// revalidates the page and this list resets. Completed sections aren't
// selectable — the batch actions only make sense on the open list.

export function CommitmentList({
  title,
  rows,
  emptyLabel,
  completed = false,
  selectable = false,
}: {
  title: string;
  rows: CommitmentRowData[];
  emptyLabel: string;
  completed?: boolean;
  selectable?: boolean;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function reset() {
    setSelecting(false);
    setSelected(new Set());
    setConfirmingDelete(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  // Keep the toggle visible while selecting even if the list empties (e.g. every
  // item just got resolved) so Cancel stays reachable.
  const canSelect = selectable && (rows.length > 0 || selecting);

  return (
    <Card>
      <CardHeader
        title={`${title} (${rows.length})`}
        action={
          canSelect ? (
            <button
              type="button"
              onClick={() => (selecting ? reset() : setSelecting(true))}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {selecting ? "Cancel" : "Select"}
            </button>
          ) : undefined
        }
      />

      {selecting ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
          <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
              }
              className="accent-gold"
            />
            Select all
          </label>
          <span className="text-[11px] text-ink-3">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-1.5">
            {confirmingDelete ? (
              <>
                <span className="text-[11px] text-ink-2">
                  Delete {selected.size} permanently?
                </span>
                <BatchForm ids={selected} op="delete" onDone={reset}>
                  <Button type="submit" variant="danger" disabled={selected.size === 0}>
                    Confirm delete
                  </Button>
                </BatchForm>
                <Button type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <BatchForm ids={selected} op="done" onDone={reset}>
                  <Button type="submit" variant="primary" disabled={selected.size === 0}>
                    Mark done
                  </Button>
                </BatchForm>
                <Button
                  type="button"
                  variant="danger"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">{emptyLabel}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <CommitmentRow
              key={r.id}
              c={r}
              completed={completed}
              selection={
                selecting
                  ? { checked: selected.has(r.id), onToggle: () => toggle(r.id) }
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

// The selected ids ride as repeated hidden "ids" fields; the action closes the
// select mode once the write lands and the page revalidates.
function BatchForm({
  ids,
  op,
  onDone,
  children,
}: {
  ids: ReadonlySet<string>;
  op: "done" | "delete";
  onDone: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      action={async (fd) => {
        await batchUpdateCommitments(fd);
        onDone();
      }}
    >
      {[...ids].map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <input type="hidden" name="op" value={op} />
      {children}
    </form>
  );
}
