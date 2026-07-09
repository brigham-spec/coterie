"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";

import {
  extractActionItems,
  saveActionItems,
  updateActionItemStatus,
  deleteActionItem,
} from "./actions";

// Action items on a meeting card (gap-audit cluster A). Extraction is
// human-in-the-loop: the AI proposes items + owners in the server action, this
// shell holds only the editable proposals until a human confirms. Nothing about
// the Anthropic call crosses to the browser. Persisted items render from props
// (server-owned) with plain-form status/delete controls.

export type OwnerOption = { id: string; name: string };

export type PersistedItem = {
  id: string;
  text: string;
  status: string;
  owner: string;
};

// A proposal being reviewed. ownerKey encodes the resolved owner as "staff:<id>"
// or "contact:<id>", or "" when the model couldn't place it (the human must pick).
type Proposal = { text: string; ownerKey: string; dropped: boolean };

function ownerKeyFor(kind: string, id: string | null): string {
  return kind === "staff" || kind === "contact" ? `${kind}:${id}` : "";
}

export function MeetingActionItems({
  meetingId,
  staffOptions,
  attendeeOptions,
  items,
}: {
  meetingId: string;
  staffOptions: OwnerOption[];
  attendeeOptions: OwnerOption[];
  items: PersistedItem[];
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, startExtract] = useTransition();
  const [saving, startSave] = useTransition();

  const kept = proposals?.filter((p) => !p.dropped) ?? [];
  const readyToSave = kept.length > 0 && kept.every((p) => p.ownerKey !== "");

  // Extract runs in the server action; we seed the editable proposals from its
  // result here (not in an effect) so the human can revise before saving.
  function onExtract() {
    setError(null);
    const fd = new FormData();
    fd.set("meetingId", meetingId);
    startExtract(async () => {
      const res = await extractActionItems({ status: "idle" }, fd);
      if (res.status === "ok") {
        setProposals(
          res.candidates.map((c) => ({
            text: c.text,
            ownerKey: ownerKeyFor(c.ownerKind, c.ownerId),
            dropped: false,
          })),
        );
      } else if (res.status === "error") {
        setError(res.message);
      }
    });
  }

  function onSave() {
    if (proposals === null) return;
    const payload = proposals
      .filter((p) => !p.dropped && p.ownerKey !== "" && p.text.trim() !== "")
      .map((p) => {
        const [ownerKind, ownerId] = p.ownerKey.split(":");
        return { text: p.text.trim(), ownerKind, ownerId };
      });
    const fd = new FormData();
    fd.set("meetingId", meetingId);
    fd.set("items", JSON.stringify(payload));
    startSave(async () => {
      await saveActionItems(fd);
      setProposals(null);
    });
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
          Action items
        </span>
        <Button
          type="button"
          variant="gold"
          onClick={onExtract}
          disabled={extracting}
        >
          {extracting ? "Extracting…" : "Extract action items"}
        </Button>
      </div>

      {error !== null ? (
        <p className="mb-2 text-[11px] text-red-600">{error}</p>
      ) : null}

      {/* Persisted items */}
      {items.length === 0 && proposals === null ? (
        <p className="text-[11px] text-ink-3">
          No action items yet. Extract them from the meeting notes above.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 text-[11px]"
            >
              <span
                className={
                  it.status === "open" ? "text-ink" : "text-ink-3 line-through"
                }
              >
                <span className="font-medium">{it.owner}</span>
                {" · "}
                {it.text}
              </span>
              <span className="flex flex-shrink-0 items-center gap-1">
                {it.status !== "done" ? (
                  <form action={updateActionItemStatus}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="status" value="done" />
                    <Button type="submit">Done</Button>
                  </form>
                ) : (
                  <form action={updateActionItemStatus}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="status" value="open" />
                    <Button type="submit">Reopen</Button>
                  </form>
                )}
                <form action={deleteActionItem}>
                  <input type="hidden" name="id" value={it.id} />
                  <Button type="submit">Delete</Button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Proposal review */}
      {proposals !== null ? (
        proposals.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-3">
            No action items found in the notes.
          </p>
        ) : (
          <div className="mt-3 rounded-sm border border-gold-line bg-surface-2 p-3">
            <p className="mb-2 text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              Review before saving
            </p>
            <ul className="flex flex-col gap-2">
              {proposals.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={p.text}
                    onChange={(e) =>
                      setProposals((prev) =>
                        prev!.map((x, j) =>
                          j === i ? { ...x, text: e.target.value } : x,
                        ),
                      )
                    }
                    disabled={p.dropped}
                    className="flex-1 rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line disabled:opacity-50"
                  />
                  <select
                    value={p.ownerKey}
                    onChange={(e) =>
                      setProposals((prev) =>
                        prev!.map((x, j) =>
                          j === i ? { ...x, ownerKey: e.target.value } : x,
                        ),
                      )
                    }
                    disabled={p.dropped}
                    className="rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line disabled:opacity-50"
                  >
                    <option value="">— choose owner —</option>
                    <optgroup label="Staff">
                      {staffOptions.map((s) => (
                        <option key={s.id} value={`staff:${s.id}`}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Attendees">
                      {attendeeOptions.map((c) => (
                        <option key={c.id} value={`contact:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setProposals((prev) =>
                        prev!.map((x, j) =>
                          j === i ? { ...x, dropped: !x.dropped } : x,
                        ),
                      )
                    }
                    className="text-[11px] text-ink-3 underline"
                  >
                    {p.dropped ? "keep" : "drop"}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={onSave}
                disabled={!readyToSave || saving}
              >
                {saving ? "Saving…" : `Save ${kept.length} item${kept.length === 1 ? "" : "s"}`}
              </Button>
              <Button type="button" onClick={() => setProposals(null)}>
                Cancel
              </Button>
              {kept.length > 0 && !readyToSave ? (
                <span className="text-[10px] text-ink-3">
                  Choose an owner for every kept item to save.
                </span>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
