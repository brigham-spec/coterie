// Pure CSV bulk-import parsing + row validation for the companies/contacts
// importer. One CSV row = a contact plus their company columns; the importer
// upserts the company by name (dedupe) and attaches the contact. This module is
// intentionally dependency-free and side-effect-free (no DB, no server-only) so
// it can be unit-tested directly and shared by both the preview and commit
// server actions — which parse the SAME raw text, keeping the server the single
// source of truth. Cross-row DB de-duplication (existing companies / emails)
// happens in the action, not here.

import { COMPANY_STATUSES } from "@/lib/company-statuses";

/// Minimal RFC-4180 parser: quoted fields, escaped "" quotes, and commas /
/// newlines inside quotes; tolerant of CRLF or LF line endings and a trailing
/// newline. Returns rows of raw cell strings (no trimming — callers trim).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawCell = false; // distinguishes a real (possibly empty) final row from EOF

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawCell = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      sawCell = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++; // consume CRLF as one break
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawCell = false;
    } else {
      field += ch;
      sawCell = true;
    }
  }

  // Flush a trailing field/row unless the text ended exactly on a line break.
  if (sawCell || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/// Dedupe key for company names: trimmed, lowercased, whitespace-collapsed.
export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/// The importer's columns and the header spellings each accepts (case- and
/// whitespace-insensitive). company_name is the only hard-required column.
export type ImportField =
  | "companyName"
  | "status"
  | "industry"
  | "annualValue"
  | "website"
  | "contactName"
  | "email"
  | "title"
  | "phone";

const IMPORT_HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  companyName: ["company_name", "company", "company name", "organization", "org"],
  status: ["status"],
  industry: ["industry", "sector"],
  annualValue: ["annual_value", "annual value", "annualvalue", "value"],
  website: ["website", "url", "web"],
  contactName: ["contact_name", "contact", "contact name", "name"],
  email: ["email", "e-mail"],
  title: ["title", "role"],
  phone: ["phone", "telephone", "tel"],
};

/// Locate each known column in the header row by alias; unknown columns are
/// ignored. Missing columns are simply absent from the returned map.
export function mapHeader(headerRow: readonly string[]): Partial<Record<ImportField, number>> {
  const normalized = headerRow.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<ImportField, number>> = {};
  for (const field of Object.keys(IMPORT_HEADER_ALIASES) as ImportField[]) {
    const aliases = IMPORT_HEADER_ALIASES[field];
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) out[field] = idx;
  }
  return out;
}

export interface ParsedRow {
  line: number; // 1-based source line, for user reference
  companyName: string;
  status: string; // a valid COMPANY_STATUSES value (defaulted to "prospect")
  industry: string;
  annualValue: string; // non-negative decimal string ("0" default)
  website: string | null;
  contactName: string;
  email: string | null; // lowercased
  title: string | null;
  phone: string | null;
}

export interface RowError {
  line: number;
  message: string;
}

export interface BuildResult {
  rows: ParsedRow[];
  errors: RowError[];
}

const DEFAULT_STATUS = "prospect";

// An explicit non-http(s) scheme (javascript:, data:, …) is dropped rather than
// stored as a company website href — the stored-XSS vector guarded elsewhere by
// assertHttpUrl. Non-throwing here so one bad cell never aborts a batch; bare
// domains and http(s) URLs pass through unchanged.
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
function safeWebsite(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  const scheme = v.match(EXPLICIT_SCHEME)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") return null;
  return v;
}

function cell(row: readonly string[], idx: number | undefined): string {
  return idx === undefined ? "" : String(row[idx] ?? "").trim();
}

/// Validate parsed CSV cells into typed rows. The first row is treated as the
/// header. Each data row becomes either a ParsedRow or a RowError (never both).
/// Company-level fields come from whichever row is processed; the action takes
/// the first row seen per company name as authoritative.
export function buildImportRows(
  cells: readonly (readonly string[])[],
  opts: { validStatuses?: readonly string[] } = {},
): BuildResult {
  const validStatuses = opts.validStatuses ?? COMPANY_STATUSES;
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  if (cells.length === 0) return { rows, errors };

  const cols = mapHeader(cells[0]);
  if (cols.companyName === undefined) {
    errors.push({ line: 1, message: "CSV is missing a company_name column" });
    return { rows, errors };
  }

  for (let i = 1; i < cells.length; i++) {
    const row = cells[i];
    const line = i + 1;

    // Skip fully-blank rows (common trailing-newline artifact).
    if (row.every((c) => String(c ?? "").trim() === "")) continue;

    const companyName = cell(row, cols.companyName);
    if (companyName === "") {
      errors.push({ line, message: "missing company_name" });
      continue;
    }

    const contactName = cell(row, cols.contactName);
    const emailRaw = cell(row, cols.email).toLowerCase();
    if (contactName === "" && emailRaw === "") {
      errors.push({ line, message: "row has neither contact_name nor email" });
      continue;
    }

    const statusRaw = cell(row, cols.status).toLowerCase();
    const status = statusRaw === "" ? DEFAULT_STATUS : statusRaw;
    if (!validStatuses.includes(status)) {
      errors.push({ line, message: `invalid status "${statusRaw}"` });
      continue;
    }

    const valueRaw = cell(row, cols.annualValue);
    let annualValue = "0";
    if (valueRaw !== "") {
      const cleaned = valueRaw.replace(/[$,]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n < 0) {
        errors.push({ line, message: `invalid annual_value "${valueRaw}"` });
        continue;
      }
      annualValue = cleaned;
    }

    rows.push({
      line,
      companyName,
      status,
      industry: cell(row, cols.industry),
      annualValue,
      website: safeWebsite(cell(row, cols.website)),
      contactName,
      email: emailRaw === "" ? null : emailRaw,
      title: cell(row, cols.title) || null,
      phone: cell(row, cols.phone) || null,
    });
  }

  return { rows, errors };
}

/// Example CSV shown on the import page as a format guide.
export const IMPORT_TEMPLATE = `company_name,status,industry,annual_value,website,contact_name,email,title,phone
Acme Capital,prospect,Finance,25000,https://acme.com,Jane Doe,jane@acme.com,CEO,555-1000
Bridge Ventures,member,Real Estate,,,Sam Roe,sam@bridge.com,Partner,555-2000`;
