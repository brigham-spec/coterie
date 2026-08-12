"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Link from "next/link";

import { Button, Table, Td, TagBadge, Textarea, Th, Tr } from "@/components/ui";

import {
  commitImport,
  previewImport,
  type ImportPreview,
  type ImportResult,
  type SampleState,
} from "./actions";

// Two-step import UI. The client holds the raw CSV text (from a file or a paste);
// Preview submits it to previewImport (validate + classify, no writes) and
// renders a counts summary + a capped sample table; Confirm submits the SAME
// text to commitImport, which re-parses and writes. Both server actions are the
// authority — the client just carries the text between the two steps. Mirrors
// the settings forms' useActionState pattern.

const previewInitial: ImportPreview = { status: "idle" };
const commitInitial: ImportResult = { status: "idle" };

const STATE_TONE: Record<SampleState, string> = {
  create: "teal",
  duplicate: "slate",
  error: "red",
};

export function ImportForm() {
  const [csvText, setCsvText] = useState("");
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
    if (file) setCsvText(await file.text());
  }

  const ready = csvText.trim() !== "";
  const previewed = preview.status === "ok";
  const willCreate =
    previewed && (preview.counts.companiesNew > 0 || preview.counts.contactsCreate > 0);

  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
          CSV file
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
        placeholder="company_name,status,industry,annual_value,website,contact_name,email,title,phone"
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
            <strong className="text-ink">{preview.counts.companiesNew}</strong> new
            {" companies · "}
            <strong className="text-ink">{preview.counts.companiesExisting}</strong>{" "}
            existing · <strong className="text-ink">{preview.counts.contactsCreate}</strong>{" "}
            contacts to create ·{" "}
            <strong className="text-ink">{preview.counts.contactsDuplicate}</strong>{" "}
            duplicates skipped ·{" "}
            <strong className="text-ink">{preview.counts.rowErrors}</strong> row errors
          </p>

          <div className="overflow-hidden rounded-sm border border-line">
            <Table
              head={
                <>
                  <Th>Line</Th>
                  <Th>Company</Th>
                  <Th>Contact</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {preview.sample.map((r) => (
                <Tr key={r.line}>
                  <Td className="text-ink-3">{r.line}</Td>
                  <Td>{r.companyName || "—"}</Td>
                  <Td>{r.state === "error" ? r.error : r.contactName || "—"}</Td>
                  <Td className="text-ink-2">{r.email ?? "—"}</Td>
                  <Td>
                    <TagBadge label={r.state} tone={STATE_TONE[r.state]} />
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>

          {result.status === "ok" ? (
            <p className="text-xs text-teal-ink">
              Imported {result.companiesCreated} companies and{" "}
              {result.contactsCreated} contacts
              {result.contactsSkipped > 0
                ? ` (${result.contactsSkipped} duplicate contacts skipped)`
                : ""}
              .{" "}
              <Link href="/dashboard/companies" className="underline">
                View companies
              </Link>
            </p>
          ) : willCreate ? (
            <form action={commitAction} className="flex items-center gap-3">
              <input type="hidden" name="csv" value={csvText} />
              <Button type="submit" variant="primary" disabled={committing}>
                {committing
                  ? "Importing…"
                  : `Confirm import — ${preview.counts.companiesNew} companies, ${preview.counts.contactsCreate} contacts`}
              </Button>
              {result.status === "error" ? (
                <span className="text-[11px] text-red-ink">{result.message}</span>
              ) : null}
            </form>
          ) : (
            <p className="text-xs text-ink-3">
              Nothing new to import — every row already exists.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
