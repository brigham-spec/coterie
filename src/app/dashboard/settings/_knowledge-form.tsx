"use client";

import { useActionState, useState } from "react";

import { Button, Field, SelectField, TagBadge, Textarea } from "@/components/ui";
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_KIND_LABELS,
  MAX_TITLE_LENGTH,
  type KnowledgeKind,
} from "@/lib/knowledge-docs";

import {
  addKnowledgeDoc,
  deleteKnowledgeDoc,
  type KnowledgeDeleteState,
  type KnowledgeUploadState,
} from "./knowledge-actions";

// Admin editor for the org's collateral store. An admin adds a document by
// uploading a PDF / text file (extracted server-side to TEXT) or pasting text,
// tagged by kind, and can delete existing ones. The stored text grounds the
// proposal + prospect value-prop generators. Mirrors the other settings forms'
// useActionState idiom; the add form remounts after a successful save so the
// file input and fields clear.

export type KnowledgeDocRow = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  sourceName: string | null;
  charCount: number;
};

const uploadInitial: KnowledgeUploadState = { status: "idle" };
const deleteInitial: KnowledgeDeleteState = { status: "idle" };

function formatChars(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k chars` : `${n} chars`;
}

export function KnowledgeForm({ docs }: { docs: KnowledgeDocRow[] }) {
  const [upload, uploadAction, uploading] = useActionState(
    addKnowledgeDoc,
    uploadInitial,
  );
  const [del, deleteAction] = useActionState(deleteKnowledgeDoc, deleteInitial);

  // Remount the add form after each successful save (clears the file input +
  // fields). Compare-and-set in render, mirroring the packages form.
  const [seen, setSeen] = useState(upload);
  const [formKey, setFormKey] = useState(0);
  if (seen !== upload) {
    setSeen(upload);
    if (upload.status === "ok") setFormKey((k) => k + 1);
  }

  const inputCls =
    "block w-full text-xs text-ink-2 file:mr-3 file:rounded-sm file:border file:border-line-2 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-ink-2 hover:file:border-ink-3";

  return (
    <div className="flex flex-col gap-5">
      {docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded border border-line p-3 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TagBadge label={KNOWLEDGE_KIND_LABELS[doc.kind]} tone="slate" />
                  <span className="truncate font-semibold text-ink">
                    {doc.title}
                  </span>
                </div>
                <p className="mt-1 truncate text-ink-3">
                  {doc.sourceName ? `${doc.sourceName} · ` : "Pasted · "}
                  {formatChars(doc.charCount)}
                </p>
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={doc.id} />
                <button
                  type="submit"
                  className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                  aria-label={`Remove ${doc.title}`}
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {del.status === "error" && (
        <span className="text-[11px] text-red-ink">{del.message}</span>
      )}

      <form
        action={uploadAction}
        className="flex flex-col gap-3 border-t border-line pt-4"
      >
        <div key={formKey} className="flex flex-col gap-3">
          <SelectField label="Document type" name="kind" defaultValue="deck">
            {KNOWLEDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KNOWLEDGE_KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>

          <Field
            label="Title (optional — defaults to the file name)"
            name="title"
            maxLength={MAX_TITLE_LENGTH}
            placeholder="2026 Chairman's Circle deck"
          />

          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              Upload a PDF or text file
            </span>
            <input
              type="file"
              name="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              className={inputCls}
            />
          </label>

          <Textarea
            label="…or paste text"
            name="text"
            rows={5}
            placeholder="Paste the collateral text here"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px]">
            {upload.status === "ok" ? (
              <span className="text-ink-2">
                Added &ldquo;{upload.title}&rdquo; ({formatChars(upload.charCount)}
                ).
              </span>
            ) : upload.status === "error" ? (
              <span className="text-red-ink">{upload.message}</span>
            ) : null}
          </span>
          <Button type="submit" variant="primary" disabled={uploading}>
            {uploading ? "Adding…" : "Add document"}
          </Button>
        </div>
      </form>
    </div>
  );
}
