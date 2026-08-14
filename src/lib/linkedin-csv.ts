// Pure parsing for a LinkedIn "Connections.csv" export — the raw ingest half of
// the LinkedIn contact layer. Dependency-free and side-effect-free (no DB, no
// server-only) so it can be unit-tested directly and shared by both the preview
// and commit server actions, which parse the SAME raw text (the server is the
// single source of truth). Only STATED fields are read here; the inferred
// dimensions are filled later by a separate enrichment pass.
//
// LinkedIn's export is NOT a plain CSV: it begins with a short "Notes:" preamble
// and a blank line before the real header row
//   First Name,Last Name,URL,Email Address,Company,Position,Connected On
// so we locate the header by scanning for the First/Last Name columns rather than
// assuming row 0 (which is what buildImportRows in csv-import.ts does).

import { parseCsv } from "@/lib/csv-import";

/// The columns we read, with the header spellings each accepts (case- and
/// whitespace-insensitive). Only the two name columns are required to consider a
/// row the header.
export type LinkedinField =
  | "firstName"
  | "lastName"
  | "url"
  | "email"
  | "company"
  | "position"
  | "connectedOn";

const LINKEDIN_HEADER_ALIASES: Record<LinkedinField, readonly string[]> = {
  firstName: ["first name", "firstname"],
  lastName: ["last name", "lastname"],
  url: ["url", "profile url", "linkedin url"],
  email: ["email address", "email", "e-mail"],
  company: ["company", "organization"],
  position: ["position", "title", "job title"],
  connectedOn: ["connected on", "connected", "connection date"],
};

/// Map a candidate header row to column indexes by alias. Returns null when the
/// row is not a plausible header (missing either name column) so the caller can
/// keep scanning past the preamble.
function mapLinkedinHeader(
  row: readonly string[],
): Partial<Record<LinkedinField, number>> | null {
  const normalized = row.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<LinkedinField, number>> = {};
  for (const field of Object.keys(LINKEDIN_HEADER_ALIASES) as LinkedinField[]) {
    const aliases = LINKEDIN_HEADER_ALIASES[field];
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) out[field] = idx;
  }
  if (out.firstName === undefined || out.lastName === undefined) return null;
  return out;
}

/// Locate the real header inside the export, skipping the "Notes:" preamble.
/// Returns the 0-based row index of the header, or -1 if no header is found.
export function findLinkedinHeader(cells: readonly (readonly string[])[]): number {
  for (let i = 0; i < cells.length; i++) {
    if (mapLinkedinHeader(cells[i]) !== null) return i;
  }
  return -1;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/// Parse LinkedIn's "Connected On" value ("24 Aug 2023") into a UTC Date, or null
/// when blank/unrecognized. Uses UTC so the stored day never drifts by timezone.
export function parseLinkedinDate(raw: string): Date | null {
  const v = raw.trim();
  if (v === "") return null;
  const m = v.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m === null) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  const year = Number(m[3]);
  if (month === undefined || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month, day));
}

/// Normalize a LinkedIn profile URL into a stable identity key: drop the scheme,
/// a leading "www.", any query/fragment, and a trailing slash, and lowercase.
/// Returns null for blank input.
export function normalizeProfileUrl(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  const stripped = v
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return stripped === "" ? null : stripped;
}

/// The one-row-per-person dedupe key: the normalized profile URL when present,
/// otherwise a normalized "name|company" fallback (LinkedIn omits the URL for some
/// connections). Always returns a non-empty string.
export function linkedinDedupeKey(
  profileUrl: string | null,
  fullName: string,
  company: string,
): string {
  const norm = normalizeProfileUrl(profileUrl ?? "");
  if (norm !== null) return `url:${norm}`;
  const name = fullName.trim().toLowerCase().replace(/\s+/g, " ");
  const co = company.trim().toLowerCase().replace(/\s+/g, " ");
  return `nc:${name}|${co}`;
}

export interface LinkedinParsedRow {
  line: number; // 1-based source line, for user reference
  dedupeKey: string;
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  title: string;
  profileUrl: string | null;
  email: string | null; // lowercased
  connectedOn: Date | null;
}

export interface LinkedinRowError {
  line: number;
  message: string;
}

export interface LinkedinBuildResult {
  headerLine: number | null; // 1-based line of the located header, null if none
  rows: LinkedinParsedRow[];
  errors: LinkedinRowError[];
}

function cell(row: readonly string[], idx: number | undefined): string {
  return idx === undefined ? "" : String(row[idx] ?? "").trim();
}

/// Validate the parsed CSV cells into typed rows. Locates the header past the
/// preamble, then turns each data row into either a LinkedinParsedRow or a
/// LinkedinRowError (never both). De-duplication against the DB happens in the
/// action; this stays pure.
export function buildLinkedinRows(
  cells: readonly (readonly string[])[],
): LinkedinBuildResult {
  const rows: LinkedinParsedRow[] = [];
  const errors: LinkedinRowError[] = [];

  const headerIdx = findLinkedinHeader(cells);
  if (headerIdx === -1) {
    errors.push({
      line: 1,
      message:
        "Could not find a LinkedIn header row (First Name / Last Name columns).",
    });
    return { headerLine: null, rows, errors };
  }

  const cols = mapLinkedinHeader(cells[headerIdx])!;

  for (let i = headerIdx + 1; i < cells.length; i++) {
    const row = cells[i];
    const line = i + 1;

    // Skip fully-blank rows (trailing-newline artifact / preamble spacers).
    if (row.every((c) => String(c ?? "").trim() === "")) continue;

    const firstName = cell(row, cols.firstName);
    const lastName = cell(row, cols.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    if (fullName === "") {
      errors.push({ line, message: "row has no name" });
      continue;
    }

    const company = cell(row, cols.company);
    const profileUrl = cell(row, cols.url) || null;
    const emailRaw = cell(row, cols.email).toLowerCase();

    rows.push({
      line,
      dedupeKey: linkedinDedupeKey(profileUrl, fullName, company),
      firstName,
      lastName,
      fullName,
      company,
      title: cell(row, cols.position),
      profileUrl,
      email: emailRaw === "" ? null : emailRaw,
      connectedOn: parseLinkedinDate(cell(row, cols.connectedOn)),
    });
  }

  return { headerLine: headerIdx + 1, rows, errors };
}

/// Parse raw exported CSV text straight into typed rows (parse + validate).
export function parseLinkedinCsv(text: string): LinkedinBuildResult {
  return buildLinkedinRows(parseCsv(text));
}
