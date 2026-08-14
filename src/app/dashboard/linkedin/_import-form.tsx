"use client";

import { useActionState, useState, type ChangeEvent } from "react";

import { Button, Field, Table, TagBadge, Td, Textarea, Th, Tr } from "@/components/ui";

import {
  commitImport,
  previewImport,
  type ImportPreview,
  type ImportResult,
  type SampleState,
} from "./actions";

// Two-step import UI for a LinkedIn "Connections.csv" export. The client holds
// the raw CSV text (from a file or a paste) plus the operator-supplied export
// date and file name; Preview submits them to previewImport (validate + classify,
// no writes) and renders a counts summary + a capped sample table; Confirm
// submits the SAME text to commitImport, which re-parses and writes. Both server
// actions are the authority — the client just carries the values between steps.

const previewInitial: ImportPreview = { status: "idle" };
const commitInitial: ImportResult = { status: "idle" };

const STATE_TONE: Record<SampleState, string> = {
  new: "teal",
  update: "gold",
  duplicate: "slate",
  error: "red",
};

export function ImportForm() {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [exportedOn, setExportedOn] = useState("");
  const [preview, previewAction, previewing] = useActionState(
    previewImport,
    previewInitial,
  );
  const [result, commitAction, committing] = useActionState(
    commitImport,
    commitInitial,
  );

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setCsvText(await file.text());
      setFileName(file.name);
    }
  }

  const ready = csvText.trim() !== "";
  const previewed = preview.status === "ok";
  const willWrite =
    previewed &&
    (preview.counts.personsNew > 0 || preview.counts.personsUpdate > 0);

  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
          Connections.csv
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="block w-full text-xs text-ink-2 file:mr-3 file:rounded-sm file:border file:border-line-2 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-ink-2 hover:file:border-ink-3"
        />
      </label>

      <Textarea
        label="…or paste CSV"
        rows={6}
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder="First Name,Last Name,URL,Email Address,Company,Position,Connected On"
      />

      <Field
        type="date"
        label="Export date (from LinkedIn's email)"
        value={exportedOn}
        onChange={(e) => setExportedOn(e.target.value)}
      />

      <form action={previewAction} className="flex items-center gap-3">
        <input type="hidden" name="csv" value={csvText} />
        <Button type="submit" variant="primary" disabled={previewing || !ready}>
          {previewing ? "Checking…" : "Preview import"}
        </Button>
        {preview.status === "error" ? (
          <span className="text-[11px] text-red-ink">{preview.message}</span>
        ) : null}
      </form>

      {previewed ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-xs text-ink-2">
            <strong className="text-ink">{preview.counts.personsNew}</strong> new
            {" · "}
            <strong className="text-ink">{preview.counts.personsUpdate}</strong>{" "}
            to update ·{" "}
            <strong className="text-ink">{preview.counts.rowsDuplicate}</strong>{" "}
            duplicate rows ·{" "}
            <strong className="text-ink">{preview.counts.rowErrors}</strong> row
            errors
          </p>

          <div className="overflow-hidden rounded-sm border border-line">
            <Table
              head={
                <>
                  <Th>Line</Th>
                  <Th>Name</Th>
                  <Th>Company</Th>
                  <Th>Title</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {preview.sample.map((r) => (
                <Tr key={r.line}>
                  <Td className="text-ink-3">{r.line}</Td>
                  <Td>{r.state === "error" ? r.error : r.name || "—"}</Td>
                  <Td className="text-ink-2">{r.company || "—"}</Td>
                  <Td className="text-ink-2">{r.title || "—"}</Td>
                  <Td>
                    <TagBadge label={r.state} tone={STATE_TONE[r.state]} />
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>

          {result.status === "ok" ? (
            <p className="text-xs text-teal-ink">
              Imported {result.created} new and updated {result.updated}{" "}
              connections. They landed un-enriched — enrichment runs separately.
            </p>
          ) : willWrite ? (
            <form action={commitAction} className="flex items-center gap-3">
              <input type="hidden" name="csv" value={csvText} />
              <input type="hidden" name="fileName" value={fileName} />
              <input type="hidden" name="exportedOn" value={exportedOn} />
              <Button type="submit" variant="primary" disabled={committing}>
                {committing
                  ? "Importing…"
                  : `Confirm import — ${preview.counts.personsNew} new, ${preview.counts.personsUpdate} updated`}
              </Button>
              {result.status === "error" ? (
                <span className="text-[11px] text-red-ink">{result.message}</span>
              ) : null}
            </form>
          ) : (
            <p className="text-xs text-ink-3">Nothing importable in this file.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
