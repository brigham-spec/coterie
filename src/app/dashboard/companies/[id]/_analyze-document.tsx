"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import {
  analyzeDocumentAction,
  applyDocumentIntel,
  type AnalyzeDocumentState,
  type ApplyDocumentIntelState,
} from "./actions";

// Client shell for analyze-document (gap-audit cluster E). Two steps, two server
// actions: upload a PDF → Analyze (the AI seam — the file is posted to the
// server, read as a document block, key never crosses to the browser) → review a
// checklist of extracted fields and apply only what's checked. The analysis is
// ephemeral; nothing is written until Apply.

const analyzeInitial: AnalyzeDocumentState = { status: "idle" };
const applyInitial: ApplyDocumentIntelState = { status: "idle" };

// The writable fields, in review order. `notesAppend` is appended, not overwritten.
const FIELDS = [
  { key: "lookingFor", label: "Looking for" },
  { key: "canOffer", label: "Can offer" },
  { key: "counties", label: "Counties / geography" },
  { key: "dealSize", label: "Deal size" },
  { key: "agencyContacts", label: "Agency contacts" },
  { key: "notesAppend", label: "Append to notes" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function AnalyzeDocument({ companyId }: { companyId: string }) {
  const [analyzeState, analyzeAction, analyzing] = useActionState(
    analyzeDocumentAction,
    analyzeInitial,
  );
  const [applyState, applyAction, applying] = useActionState(
    applyDocumentIntel,
    applyInitial,
  );
  const [dropped, setDropped] = useState<Partial<Record<FieldKey, boolean>>>({});

  const review =
    analyzeState.status === "ok" && applyState.status !== "applied"
      ? analyzeState
      : null;

  // Only the checked (non-dropped) non-empty fields are posted to the apply action.
  const selection = review
    ? FIELDS.reduce<Record<string, string>>((acc, f) => {
        const value = review.intel[f.key];
        if (value && !dropped[f.key]) acc[f.key] = value;
        return acc;
      }, {})
    : {};
  const selectedCount = Object.keys(selection).length;

  return (
    <Card>
      <CardHeader title="Analyze a document" />

      <div className="px-4 py-4">
        {review ? null : (
          <>
            <p className="mb-3 text-xs text-ink-3">
              Upload an offering memo, pitch deck, or investment summary. Claude
              reads it and proposes profile updates — review before anything is
              saved.
            </p>
            <form action={analyzeAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="companyId" value={companyId} />
              <input
                type="file"
                name="document"
                accept="application/pdf"
                required
                className="text-xs text-ink-2 file:mr-3 file:rounded-sm file:border file:border-line-2 file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:border-gold-line"
              />
              <Button type="submit" variant="gold" disabled={analyzing}>
                {analyzing ? "Reading…" : "Analyze document"}
              </Button>
            </form>
          </>
        )}

        {analyzeState.status === "error" ? (
          <p className="mt-3 text-xs text-red-600">{analyzeState.message}</p>
        ) : applyState.status === "applied" ? (
          <p className="text-xs text-ink-2">
            Applied {applyState.count} field{applyState.count === 1 ? "" : "s"} to
            this profile.
          </p>
        ) : null}

        {review ? (
          <form action={applyAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="fileName" value={review.fileName} />
            <input type="hidden" name="intel" value={JSON.stringify(selection)} />

            <p className="mb-3 text-[11px] text-ink-3">
              From <span className="text-ink-2">{review.fileName}</span>
            </p>
            {review.intel.docSummary ? (
              <p className="mb-3 text-[11.5px] leading-relaxed text-ink-2 italic">
                {review.intel.docSummary}
              </p>
            ) : null}

            <div className="space-y-2">
              {FIELDS.map((f) => {
                const value = review.intel[f.key];
                if (!value) return null;
                const checked = !dropped[f.key];
                return (
                  <label
                    key={f.key}
                    className="flex cursor-pointer gap-2 text-[11.5px] leading-relaxed text-ink-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDropped((d) => ({ ...d, [f.key]: checked }))
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <span>
                      <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                        {f.label}
                      </span>
                      <br />
                      {value}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={applying || selectedCount === 0}
              >
                {applying ? "Applying…" : `Apply ${selectedCount} selected`}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
