"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { withOrg } from "@/lib/tenant";
import {
  parseLinkedinCsv,
  type LinkedinParsedRow,
} from "@/lib/linkedin-csv";
import {
  searchLinkedinContacts,
  tokenizeQuery,
  type LinkedinSearchHit,
} from "@/lib/linkedin-search";

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

  // Kick off background enrichment so the freshly-landed rows fill their inferred
  // dimensions without blocking this response. Best-effort: a failed enqueue must
  // not fail the import — the operator can always re-run enrichment by hand, and a
  // later import re-triggers it anyway.
  try {
    await inngest.send({
      name: "coterie/linkedin.enrich",
      data: { orgId: ctx.orgId },
    });
  } catch (err) {
    console.error("failed to enqueue linkedin enrichment after import:", err);
  }

  return { status: "ok", ...result };
}

export type TriggerEnrichmentState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "queued" };

/// Manually (re-)start the background enrichment pass for this tenant's
/// un-enriched connections. Admin-only, mirroring the importer's in-action gate so
/// the result surfaces cleanly through useActionState. The Inngest job self-bounds
/// to enrichedAt:null rows, so triggering it when nothing is pending is a harmless
/// no-op.
export async function triggerEnrichment(
  _prev: TriggerEnrichmentState,
  _formData: FormData,
): Promise<TriggerEnrichmentState> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can run enrichment." };

  try {
    await inngest.send({
      name: "coterie/linkedin.enrich",
      data: { orgId: ctx.orgId },
    });
  } catch {
    return { status: "error", message: "Couldn't start enrichment. Try again." };
  }
  return { status: "queued" };
}

export type LinkedinSearchState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; query: string; hits: LinkedinSearchHit[]; searched: number };

/// Deterministic recall search over this tenant's ENRICHED connections. Admin-only
/// (mirroring the importer's in-action gate so the result surfaces cleanly through
/// useActionState). The "invisible until enriched" rule is enforced at the query —
/// only enrichedAt:null-excluded rows are ever loaded, so an un-enriched connection
/// can never appear in a recall result. The scoring itself is pure + explainable
/// (see linkedin-search.ts): every hit reports which stated/inferred fields matched.
export async function searchLinkedin(
  _prev: LinkedinSearchState,
  formData: FormData,
): Promise<LinkedinSearchState> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin")
    return { status: "error", message: "Only admins can search connections." };

  const query = String(formData.get("query") ?? "").trim();
  if (query === "")
    return { status: "error", message: "Enter what you're looking for." };
  if (tokenizeQuery(query).length === 0)
    return {
      status: "error",
      message: "Add a search term — try an industry, role, or company.",
    };

  const rows = await withOrg(ctx.orgId, (tx) =>
    tx.linkedinContact.findMany({
      where: { enrichedAt: { not: null } },
      select: {
        id: true,
        fullName: true,
        company: true,
        title: true,
        profileUrl: true,
        industry: true,
        industryConfidence: true,
        seniority: true,
        seniorityConfidence: true,
        jobFunction: true,
        jobFunctionConfidence: true,
      },
    }),
  );

  const hits = searchLinkedinContacts(rows, query);
  return { status: "ok", query, hits, searched: rows.length };
}
