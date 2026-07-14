"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import {
  parseQuickCaptureAction,
  saveQuickCapture,
  type QuickCaptureState,
  type SaveCaptureState,
} from "./quick-capture-actions";

// Client shell for quick capture (gap-audit cluster E). Two steps, two server
// actions: type a plain-English note → Capture (the AI seam) → review the
// structured result (matched contacts, meeting, follow-ups, suggested intros,
// new prospects) → Save. The parse is ephemeral; only the reviewed Save writes.

const parseInitial: QuickCaptureState = { status: "idle" };
const saveInitial: SaveCaptureState = { status: "idle" };

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
        {children}
      </div>
    </div>
  );
}

export function QuickCapture() {
  const [parseState, parseAction, parsing] = useActionState(
    parseQuickCaptureAction,
    parseInitial,
  );
  const [saveState, saveAction, saving] = useActionState(
    saveQuickCapture,
    saveInitial,
  );
  const [discarded, setDiscarded] = useState(false);

  const review =
    parseState.status === "ok" && !discarded && saveState.status !== "saved"
      ? parseState.review
      : null;

  return (
    <Card>
      <CardHeader title="Quick capture" />
      <form action={parseAction} className="p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
            What just happened?
          </span>
          <textarea
            name="note"
            rows={3}
            required
            placeholder='e.g. "Had coffee with Sarah from Bethel Woods — she needs a land use attorney for a Catskill project, follow up next Tuesday, intro her to Drew Lang."'
            className="w-full rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line"
          />
        </label>
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="gold" disabled={parsing}>
            {parsing ? "Reading…" : "Capture"}
          </Button>
        </div>
      </form>

      {parseState.status === "error" ? (
        <p className="px-4 pb-4 text-xs text-red-ink">{parseState.message}</p>
      ) : null}

      {saveState.status === "saved" ? (
        <p className="px-4 pb-4 text-xs text-ink-2">
          Saved
          {saveState.meeting
            ? ` a meeting${saveState.attendees ? ` with ${saveState.attendees} contact${saveState.attendees === 1 ? "" : "s"}` : ""}`
            : ""}
          {saveState.prospects
            ? `${saveState.meeting ? " and" : ""} ${saveState.prospects} new prospect${saveState.prospects === 1 ? "" : "s"}`
            : ""}
          .
        </p>
      ) : null}

      {review ? (
        <form action={saveAction} className="border-t border-line p-4">
          <input type="hidden" name="capture" value={JSON.stringify(review)} />

          {review.matched.length > 0 ? (
            <Section label="Contacts">
              {review.matched.map((m) => `${m.name} · ${m.org}`).join("\n")}
            </Section>
          ) : null}
          {review.title ? <Section label="Title">{review.title}</Section> : null}
          {review.summary ? (
            <Section label="Summary">{review.summary}</Section>
          ) : null}
          {review.actionItems.length > 0 ? (
            <Section label="Follow-ups">
              {review.actionItems.map((a) => `• ${a}`).join("\n")}
            </Section>
          ) : null}
          {review.suggestedIntros.length > 0 ? (
            <Section label="Suggested intros (review in Introductions)">
              {review.suggestedIntros
                .map((i) => `→ ${i.toOrg}${i.reason ? `: ${i.reason}` : ""}`)
                .join("\n")}
            </Section>
          ) : null}
          {review.newProspects.length > 0 ? (
            <Section label="New prospects">
              {review.newProspects
                .map(
                  (p) =>
                    `${p.org || p.name}${p.notes ? ` — ${p.notes}` : ""}`,
                )
                .join("\n")}
            </Section>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" onClick={() => setDiscarded(true)} disabled={saving}>
              Discard
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save all"}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
