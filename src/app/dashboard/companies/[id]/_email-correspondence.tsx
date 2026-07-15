"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader, TagBadge, Textarea } from "@/components/ui";
import { actionItemCount, sentimentTone } from "@/lib/email-intel";

import {
  deleteEmailCorrespondence,
  extractEmailThreadAction,
  saveEmailMessage,
  type ExtractEmailState,
  type SaveEmailMessageState,
} from "./actions";

// Email correspondence (member-profile parity, sibling to the Meetings card).
// Production email otherwise arrives only from the org-level Zapier sync; this
// card lets staff paste a thread directly on the profile — Claude extracts the
// same EmailMessage shape (the AI seam runs server-side, key never crosses to the
// browser), the operator reviews it, and Save persists one row scoped to this
// company. The list below shows all correspondence for the company (synced +
// manual); manual rows carry a tag. Writes go through the withOrg-scoped actions.

const extractInitial: ExtractEmailState = { status: "idle" };
const saveInitial: SaveEmailMessageState = { status: "idle" };

// The reviewed extraction, derived from the action's success state.
type Draft = Extract<ExtractEmailState, { status: "ok" }>["extraction"];

export type EmailRow = {
  id: string;
  subject: string;
  summary: string;
  projects: string;
  actionItems: string;
  sentiment: string;
  emailDate: string;
  fromName: string;
  fromEmail: string;
  isManual: boolean;
};

export function EmailCorrespondence({
  companyId,
  messages,
}: {
  companyId: string;
  messages: EmailRow[];
}) {
  const [extractState, extractAction, extracting] = useActionState(
    extractEmailThreadAction,
    extractInitial,
  );
  const [saveState, saveAction, saving] = useActionState(
    saveEmailMessage,
    saveInitial,
  );
  const [open, setOpen] = useState(false);

  // The review panel is the fresh extraction, derived straight from the action
  // state — it disappears once a save lands (mirrors the analyze-document card).
  const review: Draft | null =
    extractState.status === "ok" && saveState.status !== "saved"
      ? extractState.extraction
      : null;

  return (
    <Card>
      <CardHeader
        title="Email correspondence"
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
        <div className="border-b border-line p-4">
          {review ? (
            <EmailReview
              companyId={companyId}
              draft={review}
              saveAction={saveAction}
              saving={saving}
            />
          ) : (
            <form action={extractAction} className="flex flex-col gap-3">
              <input type="hidden" name="companyId" value={companyId} />
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
          {saveState.status === "saved" ? (
            <p className="mt-2 text-xs text-ink-2">Saved to correspondence.</p>
          ) : null}
        </div>
      ) : null}

      {messages.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No correspondence logged with this company yet. Paste a thread to extract
          it.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {messages.map((m) => (
            <EmailItem key={m.id} companyId={companyId} message={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmailReview({
  companyId,
  draft,
  saveAction,
  saving,
}: {
  companyId: string;
  draft: Draft;
  saveAction: (formData: FormData) => void;
  saving: boolean;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Subject", value: draft.subject },
    { label: "From", value: [draft.fromName, draft.fromEmail].filter(Boolean).join(" · ") },
    { label: "Date", value: draft.emailDate },
    { label: "Summary", value: draft.summary },
    { label: "Projects", value: draft.projects },
    { label: "Action items", value: draft.actionItems },
    { label: "Sentiment", value: draft.sentiment },
  ];
  return (
    <form action={saveAction} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="extraction" value={JSON.stringify(draft)} />

      <div className="space-y-2">
        {rows.map((r) =>
          r.value ? (
            <div key={r.label} className="text-[11.5px] leading-relaxed text-ink-2">
              <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                {r.label}
              </span>
              <br />
              {r.value}
            </div>
          ) : null,
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save thread"}
        </Button>
      </div>
    </form>
  );
}

function EmailItem({
  companyId,
  message,
}: {
  companyId: string;
  message: EmailRow;
}) {
  const aiCount = actionItemCount(message.actionItems);
  return (
    <li className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">
            {message.subject || "(no subject)"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-3">
            {message.fromName || message.fromEmail ? (
              <span>{message.fromName || message.fromEmail}</span>
            ) : null}
            {message.emailDate ? <span>· {message.emailDate}</span> : null}
            {message.isManual ? <span>· Manual</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message.sentiment ? (
            <TagBadge label={message.sentiment} tone={sentimentTone(message.sentiment)} />
          ) : null}
          {message.isManual ? (
            <form action={deleteEmailCorrespondence}>
              <input type="hidden" name="id" value={message.id} />
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
      </div>
      {message.summary ? (
        <p className="text-xs leading-relaxed text-ink-2">{message.summary}</p>
      ) : null}
      {message.projects ? (
        <p className="text-[10.5px] text-teal-ink">
          <span className="font-medium">Projects: </span>
          {message.projects}
        </p>
      ) : null}
      {aiCount > 0 ? (
        <p className="text-[10.5px] text-gold-ink">
          {aiCount} action item{aiCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </li>
  );
}
