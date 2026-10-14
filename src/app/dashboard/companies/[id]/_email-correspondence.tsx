"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { Button, Field, SelectField, TagBadge, Textarea } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SENTIMENTS, parseActionItems, sentimentTone } from "@/lib/email-intel";

import {
  deleteEmailCorrespondence,
  extractEmailThreadAction,
  saveEmailMessage,
  toggleEmailActionItem,
  updateEmailMessage,
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

// The reviewed extraction, derived from the action's success state — this is
// the EmailExtraction shape (8 string fields), reused as the editable field set
// for both the review panel and the saved-row editor. A stored EmailRow is a
// superset of it, so it can seed the editor directly.
type Draft = Extract<ExtractEmailState, { status: "ok" }>["extraction"];

export type EmailRow = {
  id: string;
  subject: string;
  summary: string;
  projects: string;
  actionItems: string;
  doneActionItems: number[];
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
    <CollapsibleCard
      id="company-email"
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
    >
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
    </CollapsibleCard>
  );
}

// The editable field set, controlled from a draft held by the parent form. The
// hidden `extraction` input (serialized by the parent) is what the server
// re-coerces through parseEmailExtraction, so these inputs are display + edit
// only — no name attributes needed.
function EmailFields({
  value,
  onChange,
}: {
  value: Draft;
  onChange: (next: Draft) => void;
}) {
  const set = <K extends keyof Draft>(key: K, v: string) =>
    onChange({ ...value, [key]: v });
  return (
    <>
      <Field
        label="Subject"
        value={value.subject}
        onChange={(e) => set("subject", e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="From name"
          value={value.fromName}
          onChange={(e) => set("fromName", e.target.value)}
        />
        <Field
          label="From email"
          value={value.fromEmail}
          onChange={(e) => set("fromEmail", e.target.value)}
        />
      </div>
      <Field
        label="Date"
        value={value.emailDate}
        onChange={(e) => set("emailDate", e.target.value)}
      />
      <Textarea
        label="Summary"
        value={value.summary}
        onChange={(e) => set("summary", e.target.value)}
      />
      <Textarea
        label="Projects"
        value={value.projects}
        onChange={(e) => set("projects", e.target.value)}
      />
      <Textarea
        label="Action items"
        value={value.actionItems}
        onChange={(e) => set("actionItems", e.target.value)}
      />
      <SelectField
        label="Sentiment"
        value={value.sentiment}
        onChange={(e) => set("sentiment", e.target.value)}
      >
        <option value="">—</option>
        {SENTIMENTS.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </SelectField>
    </>
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
  const [edited, setEdited] = useState<Draft>(draft);
  return (
    <form action={saveAction} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="extraction" value={JSON.stringify(edited)} />

      <EmailFields value={edited} onChange={setEdited} />

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
  const [editing, setEditing] = useState(false);

  // Only manual (pasted) rows are editable — synced rows are owned by the org
  // Zapier sync, which overwrites their highlights on every re-sync.
  if (editing && message.isManual) {
    return (
      <li className="p-4">
        <EmailEditForm
          companyId={companyId}
          message={message}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const items = parseActionItems(message.actionItems);
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
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
              >
                Edit
              </button>
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
            </>
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
      {items.length > 0 ? (
        <EmailActionItems
          companyId={companyId}
          messageId={message.id}
          items={items}
          done={message.doneActionItems}
        />
      ) : null}
    </li>
  );
}

// Inline editor for a saved manual row. Mirrors EmailReview — a local draft
// feeds the hidden `extraction` JSON, re-coerced server-side by the same
// parseEmailExtraction bounds. Closes on a successful save.
function EmailEditForm({
  companyId,
  message,
  onDone,
}: {
  companyId: string;
  message: EmailRow;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    updateEmailMessage,
    saveInitial,
  );
  const [edited, setEdited] = useState<Draft>(message);

  // Close on a successful save. This fires once: onDone() unmounts the form (the
  // row returns to its read-only branch), so the stale "saved" can't re-trigger.
  useEffect(() => {
    if (state.status === "saved") onDone();
  }, [state.status, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={message.id} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="extraction" value={JSON.stringify(edited)} />

      <EmailFields value={edited} onChange={setEdited} />

      {state.status === "error" ? (
        <p className="text-xs text-red-ink">{state.message}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="default" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

// The email's action items as checkable follow-ups (Email item 9). Local state
// flips the checkbox instantly; the server action persists the checked index set
// per tenant (the page revalidation reconciles the authoritative order).
function EmailActionItems({
  companyId,
  messageId,
  items,
  done,
}: {
  companyId: string;
  messageId: string;
  items: string[];
  done: number[];
}) {
  const [doneSet, setDoneSet] = useState<Set<number>>(() => new Set(done));
  const [, startToggle] = useTransition();

  return (
    <ul className="mt-0.5 flex flex-col gap-1">
      {items.map((item, i) => {
        const isDone = doneSet.has(i);
        return (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-1.5 text-[10.5px] leading-snug">
              <input
                type="checkbox"
                checked={isDone}
                onChange={(e) => {
                  const next = e.target.checked;
                  const flip = (checked: boolean) =>
                    setDoneSet((prev) => {
                      const s = new Set(prev);
                      if (checked) s.add(i);
                      else s.delete(i);
                      return s;
                    });
                  flip(next); // optimistic
                  startToggle(async () => {
                    const f = new FormData();
                    f.set("id", messageId);
                    f.set("companyId", companyId);
                    f.set("index", String(i));
                    f.set("done", String(next));
                    const r = await toggleEmailActionItem(f);
                    // Roll the checkbox back if the write was refused.
                    if (r.status === "error") flip(!next);
                  });
                }}
                className="mt-0.5 shrink-0 accent-gold"
              />
              <span className={isDone ? "text-ink-3 line-through" : "text-gold-ink"}>
                {item}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
