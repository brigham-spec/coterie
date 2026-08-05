"use client";

import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";
import type { OutreachAngle } from "@/lib/event-outreach";

import {
  draftOutreach,
  markOutreachSent,
  type OutreachState,
} from "../actions";

// Outreach batch panel (Events audit — ported from the prototype's
// renderOutreachDrafts). A client shell over the draftOutreach / markOutreachSent
// server actions, so the Anthropic key never crosses to the browser. It drafts a
// personal invitation email for every invited CRM guest — one at a time or all at
// once — and tracks each guest through not-started → draft ready → sent. Drafts
// persist on the invitee (so a batch survives a reload); refinement chips redraft
// a finished draft from a different angle. Guests can be edited before sending.

type Stage = "none" | "draft" | "sent";

type Guest = {
  id: string;
  name: string;
  org: string | null;
  status: string;
  draft: string;
};

type Row = {
  id: string;
  name: string;
  org: string | null;
  status: Stage;
  draft: string;
};

const idle: OutreachState = { status: "idle" };

function stageOf(value: string): Stage {
  return value === "sent" ? "sent" : value === "draft" ? "draft" : "none";
}

// Refinement angles the host can pick to redraft (values are OutreachAngle, so a
// typo or drift from the union is a compile error).
const ANGLES: { value: OutreachAngle; label: string; title: string }[] = [
  { value: "shorter", label: "Shorter", title: "3 sentences max" },
  { value: "lead_event", label: "Event first", title: "Open with the event, then connect to them" },
  { value: "lead_connection", label: "Connection first", title: "Open with someone they know attending" },
  { value: "direct", label: "Direct", title: "Skip the warm-up — first sentence is the invitation" },
  { value: "standard", label: "Fresh take", title: "Same brief, a different opening and angle" },
];

const STAGE_LABEL: Record<Stage, string> = {
  none: "Not started",
  draft: "Draft ready",
  sent: "Sent",
};

const STAGE_TONE: Record<Stage, string> = {
  none: "text-ink-3",
  draft: "text-gold-ink",
  sent: "text-teal-ink",
};

export function Outreach({
  eventId,
  guests,
}: {
  eventId: string;
  guests: Guest[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    guests.map((g) => ({ ...g, status: stageOf(g.status) })),
  );
  // Which guests are mid-draft, batch progress, and the collapsed (sent) rows.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(rows.filter((r) => r.status === "sent").map((r) => r.id)),
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sentCount = rows.filter((r) => r.status === "sent").length;
  const draftCount = rows.filter((r) => r.status === "draft").length;
  const noneCount = rows.length - sentCount - draftCount;

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Draft (or redraft) one guest. Persists server-side and updates the row.
  async function draftOne(id: string, angle: OutreachAngle | null): Promise<boolean> {
    setError(null);
    setBusy((prev) => new Set(prev).add(id));
    try {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("inviteeId", id);
      if (angle) fd.set("angle", angle);
      const res = await draftOutreach(idle, fd);
      if (res.status === "ok") {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, draft: res.draft, status: r.status === "sent" ? "sent" : "draft" }
              : r,
          ),
        );
        return true;
      }
      if (res.status === "error") setError(res.message);
      return false;
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Batch: draft every guest who hasn't been drafted yet, sequentially (bounds AI
  // spend, honours the per-org rate limit, and shows real progress). Stops on the
  // first failure so a rate-limit cap surfaces once.
  async function draftAll() {
    const pending = rows.filter((r) => r.draft.trim() === "");
    if (pending.length === 0) return;
    setError(null);
    for (let i = 0; i < pending.length; i++) {
      setBatch({ done: i, total: pending.length });
      const ok = await draftOne(pending[i].id, null);
      if (!ok) break;
    }
    setBatch(null);
  }

  // Toggle a guest between sent and draft, optimistically. Persists the current
  // draft body too, so a host edit before "Mark sent" sticks.
  async function toggleSent(row: Row) {
    const nextSent = row.status !== "sent";
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, status: nextSent ? "sent" : "draft" } : r)),
    );
    if (nextSent) setCollapsed((prev) => new Set(prev).add(row.id));
    try {
      const fd = new FormData();
      fd.set("inviteeId", row.id);
      fd.set("sent", String(nextSent));
      fd.set("draft", row.draft);
      await markOutreachSent(fd);
    } catch {
      setError("Could not update the status. Try again.");
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)),
      );
    }
  }

  function editDraft(id: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, draft: value } : r)));
  }

  function copy(row: Row) {
    if (row.draft.trim() === "") return;
    void navigator.clipboard.writeText(row.draft).then(
      () => {
        setCopiedId(row.id);
        setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500);
      },
      () => {},
    );
  }

  const drafting = busy.size > 0;

  return (
    <Card>
      <CardHeader
        title="Draft invitations"
        action={
          rows.length > 0 ? (
            <button
              type="button"
              onClick={draftAll}
              disabled={drafting}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-50"
            >
              {batch ? `Drafting ${batch.done + 1} of ${batch.total}…` : "Draft all"}
            </button>
          ) : undefined
        }
      />
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            Invite a guest from the network first, then draft a personal invitation
            email for them.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-ink-3">
              Write a personal invitation for each guest in your voice — grounded in
              what you know about them. Draft all at once or one at a time, refine the
              angle, then edit before sending.
            </p>

            {sentCount + draftCount > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
                {sentCount > 0 ? (
                  <span className="rounded-full bg-teal-bg px-2 py-0.5 text-teal-ink">
                    {sentCount} sent
                  </span>
                ) : null}
                {draftCount > 0 ? (
                  <span className="rounded-full bg-gold-bg px-2 py-0.5 text-gold-ink">
                    {draftCount} draft
                  </span>
                ) : null}
                {noneCount > 0 ? (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-3">
                    {noneCount} not started
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {rows.map((row) => {
                const isOpen = !collapsed.has(row.id);
                const isBusy = busy.has(row.id);
                const hasDraft = row.draft.trim() !== "";
                return (
                  <div
                    key={row.id}
                    className="overflow-hidden rounded-md border border-line"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(row.id)}
                      className="flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left"
                    >
                      <span className="flex-1 text-[11.5px] font-medium text-ink">
                        {row.name}
                        {row.org && row.org !== row.name ? (
                          <span className="ml-1.5 text-[10px] font-normal text-ink-3">
                            {row.org}
                          </span>
                        ) : null}
                      </span>
                      <span className={`text-[9px] ${STAGE_TONE[row.status]}`}>
                        {STAGE_LABEL[row.status]}
                      </span>
                      <span className="text-[10px] text-ink-3">{isOpen ? "▴" : "▾"}</span>
                    </button>

                    {isOpen ? (
                      <div className="border-t border-line p-3">
                        <textarea
                          value={row.draft}
                          onChange={(e) => editDraft(row.id, e.target.value)}
                          rows={5}
                          placeholder='Click "Draft" to generate a personal invitation…'
                          className="mb-2 w-full resize-y rounded-sm border border-line-2 bg-surface px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none focus:border-gold-line"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="gold"
                            onClick={() => void draftOne(row.id, null)}
                            disabled={isBusy}
                          >
                            {isBusy ? "Drafting…" : hasDraft ? "Redraft" : "Draft"}
                          </Button>
                          <button
                            type="button"
                            onClick={() => copy(row)}
                            disabled={!hasDraft}
                            className="text-[10px] text-ink-3 hover:text-gold disabled:opacity-40"
                          >
                            {copiedId === row.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleSent(row)}
                            disabled={!hasDraft}
                            className={`text-[10px] disabled:opacity-40 ${
                              row.status === "sent"
                                ? "text-teal-ink hover:underline"
                                : "text-ink-3 hover:text-gold"
                            }`}
                          >
                            {row.status === "sent" ? "Sent — undo" : "Mark sent"}
                          </button>
                        </div>

                        {hasDraft ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-2">
                            <span className="text-[9px] text-ink-3">Try:</span>
                            {ANGLES.map((a) => (
                              <button
                                key={a.value}
                                type="button"
                                title={a.title}
                                onClick={() => void draftOne(row.id, a.value)}
                                disabled={isBusy}
                                className="rounded-full border border-line px-2 py-0.5 text-[9.5px] text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {error ? <p className="mt-3 text-[11px] text-red-ink">{error}</p> : null}
          </>
        )}
      </div>
    </Card>
  );
}
