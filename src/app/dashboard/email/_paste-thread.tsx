"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader, Textarea } from "@/components/ui";

import {
  extractEmailThread,
  saveEmailThread,
  type ExtractThreadState,
  type SaveThreadState,
} from "./actions";

// Paste-a-thread → meeting note (Email audit items 8 + 10). The org-level sibling
// of the company-profile paste card: staff paste a raw thread here, Claude reads
// it into a meeting-shaped note (the AI seam runs server-side, the key never
// crosses to the browser), and the operator reviews the extraction — including
// which company the sender matched (or "New prospect" when nothing matched) —
// before Save persists a Meeting attributed to that company. Any new organisations
// the thread surfaced are listed so the operator knows they'll be created too.

const extractInitial: ExtractThreadState = { status: "idle" };
const saveInitial: SaveThreadState = { status: "idle" };

type Draft = Extract<ExtractThreadState, { status: "ok" }>;

export function PasteThread() {
  const [extractState, extractAction, extracting] = useActionState(
    extractEmailThread,
    extractInitial,
  );
  const [saveState, saveAction, saving] = useActionState(
    saveEmailThread,
    saveInitial,
  );
  const [open, setOpen] = useState(false);

  // The review panel is the fresh extraction, derived straight from the action
  // state. It disappears once THIS draft is saved, but a subsequently-extracted
  // thread (a different summary than the one just saved) re-opens it — so the
  // operator can log several threads in a row without leaving the page.
  const savedSummary =
    saveState.status === "saved" ? saveState.savedSummary : null;
  const review: Draft | null =
    extractState.status === "ok" &&
    extractState.extraction.summary !== savedSummary
      ? extractState
      : null;

  return (
    <div className="mb-5 mt-4">
      <Card>
        <CardHeader
          title="Paste an email thread"
          action={
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {open ? "Close" : "Paste thread"}
            </button>
          }
        />

        {open ? (
          <div className="p-4">
            {review ? (
              <ThreadReview
                draft={review}
                saveAction={saveAction}
                saving={saving}
              />
            ) : (
              <form action={extractAction} className="flex flex-col gap-3">
                <Textarea
                  name="thread"
                  label="Paste the full email thread"
                  rows={6}
                  required
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="gold" disabled={extracting}>
                    {extracting ? "Reading…" : "Extract with AI"}
                  </Button>
                </div>
              </form>
            )}
            {extractState.status === "error" ? (
              <p className="mt-2 text-xs text-red-ink">{extractState.message}</p>
            ) : null}
            {saveState.status === "error" ? (
              <p className="mt-2 text-xs text-red-ink">{saveState.message}</p>
            ) : null}
            {saveState.status === "saved" && review === null ? (
              <p className="mt-2 text-xs text-ink-2">
                Saved as a meeting note. Paste another thread to log more.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function ThreadReview({
  draft,
  saveAction,
  saving,
}: {
  draft: Draft;
  saveAction: (formData: FormData) => void;
  saving: boolean;
}) {
  const { extraction, matchedCompany } = draft;
  const rows: { label: string; value: string }[] = [
    { label: "Meeting", value: extraction.meetingTitle },
    { label: "Date", value: extraction.meetingDate },
    {
      label: "From",
      value: [extraction.primaryContact.name, extraction.primaryContact.org]
        .filter(Boolean)
        .join(" · "),
    },
    { label: "Summary", value: extraction.summary },
    { label: "Action items", value: extraction.actionItems },
    { label: "Key insights", value: extraction.keyInsights },
  ];

  return (
    <form action={saveAction} className="flex flex-col gap-3">
      <input
        type="hidden"
        name="extraction"
        value={JSON.stringify(extraction)}
      />

      <div className="rounded-sm border border-line bg-surface-2 px-3 py-2 text-[11px]">
        <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
          Attaches to
        </span>
        <br />
        {matchedCompany ? (
          <span className="text-ink-2">{matchedCompany.name}</span>
        ) : (
          <span className="text-gold-ink">
            New prospect ·{" "}
            {extraction.primaryContact.org ||
              extraction.primaryContact.name ||
              "unknown sender"}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) =>
          r.value ? (
            <div
              key={r.label}
              className="text-[11.5px] leading-relaxed text-ink-2"
            >
              <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                {r.label}
              </span>
              <br />
              {r.value}
            </div>
          ) : null,
        )}
      </div>

      {extraction.newProspects.length > 0 ? (
        <div className="text-[11px] text-ink-2">
          <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
            New prospects to create
          </span>
          <ul className="mt-1 list-disc pl-4">
            {extraction.newProspects.map((p, i) => (
              <li key={i}>{[p.org, p.name].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save as meeting"}
        </Button>
      </div>
    </form>
  );
}
