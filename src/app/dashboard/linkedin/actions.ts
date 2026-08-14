"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  parseLinkedinCsv,
  type LinkedinParsedRow,
} from "@/lib/linkedin-csv";

// Admin-only importer for a LinkedIn "Connections.csv" export. The rows land in a
// SEPARATE storage tier (linkedin_contacts) so they never clutter the members or
// contacts lists. Both actions parse the SAME raw CSV text (the client holds it
// and re-submits it) so the server stays the source of truth — preview never
// writes, commit re-parses rather than trusting a client payload.
//
// One row per person: within a single file we collapse repeats by dedupeKey; on
// re-import an existing person is UPDATED (its stated fields + newest snapshot),
// never duplicated. Only STATED fields are written here; the inferred dimensions
// and enrichedAt stay null — the enrichment pass fills them separately, so a raw
// import is honestly "un-enriched" and invisible to the recall search.
//
// The gate is an in-action role check (returning an error state) rather than
// requireAdmin's throw, so the result surfaces cleanly through useActionState.

export type SampleState = "new" | "update" | "duplicate" | "error";

interface SampleRow {
  line: number;
  name: string;
  company: string;
  title: string;
  state: SampleState;
  error?: string;
}

export type ImportPreview =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      sample: SampleRow[];
      counts: {
        personsNew: number;
        personsUpdate: number;
        rowsDuplicate: number;
        rowErrors: number;
      };
    };

export type ImportResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; created: number; updated: number };

// Cap the preview table so a thousand-row upload doesn't ship a giant payload;
// the counts above it still reflect the whole file.
const SAMPLE_LIMIT = 50;

// A re-import of a large connections file updates one existing row per person in
// a sequential loop; raise the interactive-tx timeout above the 5s default so a
// thousand-row re-import isn't rolled back mid-write.
const COMMIT_TIMEOUT_MS = 60_000;

function readCsv(formData: FormData): string {
  return String(formData.get("csv") ?? "");
}

// LinkedIn's CSV never embeds the export date, so the operator supplies it. Parse
// the yyyy-mm-dd from the form's date input into a UTC Date (null when blank).
function readExportedOn(formData: FormData): Date | null {
  const raw = String(formData.get("exportedOn") ?? "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m === null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export async function previewImport(
  _prev: ImportPreview,
  formData: FormData,
): Promise<ImportPreview> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can import." };

  const csv = readCsv(formData);
  if (csv.trim() === "")
    return { status: "error", message: "Paste or upload a LinkedIn export first." };

  const { rows, errors } = parseLinkedinCsv(csv);
  if (rows.length === 0 && errors.length === 0)
    return { status: "error", message: "No connections found in the CSV." };

  const existingKeys = await withOrg(ctx.orgId, async (tx) => {
    const existing = await tx.linkedinContact.findMany({
      select: { dedupeKey: true },
    });
    return new Set(existing.map((c) => c.dedupeKey));
  });

  const seenKeys = new Set<string>();
  const sample: SampleRow[] = [];
  let personsNew = 0;
  let personsUpdate = 0;
  let rowsDuplicate = 0;

  for (const row of rows) {
    let state: SampleState;
    if (seenKeys.has(row.dedupeKey)) {
      state = "duplicate"; // repeated person within this same file
      rowsDuplicate++;
    } else {
      seenKeys.add(row.dedupeKey);
      if (existingKeys.has(row.dedupeKey)) {
        state = "update";
        personsUpdate++;
      } else {
        state = "new";
        personsNew++;
      }
    }
    sample.push({
      line: row.line,
      name: row.fullName,
      company: row.company,
      title: row.title,
      state,
    });
  }

  for (const e of errors)
    sample.push({ line: e.line, name: "", company: "", title: "", state: "error", error: e.message });
  sample.sort((a, b) => a.line - b.line);

  return {
    status: "ok",
    sample: sample.slice(0, SAMPLE_LIMIT),
    counts: { personsNew, personsUpdate, rowsDuplicate, rowErrors: errors.length },
  };
}

export async function commitImport(
  _prev: ImportResult,
  formData: FormData,
): Promise<ImportResult> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can import." };

  const csv = readCsv(formData);
  if (csv.trim() === "")
    return { status: "error", message: "Paste or upload a LinkedIn export first." };

  const { rows } = parseLinkedinCsv(csv);
  if (rows.length === 0)
    return { status: "error", message: "No importable connections found in the CSV." };

  const exportedOn = readExportedOn(formData);
  const fileName = String(formData.get("fileName") ?? "").trim() || null;

  // Collapse within-file repeats to one row per person (last occurrence wins).
  const byKey = new Map<string, LinkedinParsedRow>();
  for (const row of rows) byKey.set(row.dedupeKey, row);
  const people = [...byKey.values()];

  const result = await withOrg(ctx.orgId, async (tx) => {
    // Sequential reads/writes: one pooled connection per withOrg tx.
    const existing = await tx.linkedinContact.findMany({
      select: { id: true, dedupeKey: true },
    });
    const keyToId = new Map(existing.map((c) => [c.dedupeKey, c.id]));

    // The snapshot-of-record for this file. Its id becomes each row's importId,
    // so a re-imported person automatically points at the most recent export.
    const importRow = await tx.linkedinImport.create({
      data: {
        orgId: ctx.orgId,
        exportedOn,
        fileName,
        rowCount: people.length,
        importedByUserId: ctx.userId,
      },
      select: { id: true },
    });

    const stated = (row: LinkedinParsedRow) => ({
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      company: row.company,
      title: row.title,
      profileUrl: row.profileUrl,
      email: row.email,
      connectedOn: row.connectedOn,
    });

    const inserts: LinkedinParsedRow[] = [];
    const updates: LinkedinParsedRow[] = [];
    for (const row of people) {
      if (keyToId.has(row.dedupeKey)) updates.push(row);
      else inserts.push(row);
    }

    if (inserts.length > 0) {
      await tx.linkedinContact.createMany({
        data: inserts.map((row) => ({
          orgId: ctx.orgId,
          importId: importRow.id,
          dedupeKey: row.dedupeKey,
          ...stated(row),
        })),
      });
    }

    // Re-import: refresh the stated fields + repoint at the newest snapshot.
    // Inferred dimensions + enrichedAt are deliberately left untouched so a
    // re-import never wipes prior enrichment.
    for (const row of updates) {
      await tx.linkedinContact.update({
        where: { orgId_dedupeKey: { orgId: ctx.orgId, dedupeKey: row.dedupeKey } },
        data: { importId: importRow.id, ...stated(row) },
      });
    }

    return { created: inserts.length, updated: updates.length };
  }, { timeout: COMMIT_TIMEOUT_MS });

  revalidatePath("/dashboard/linkedin");

  return { status: "ok", ...result };
}
