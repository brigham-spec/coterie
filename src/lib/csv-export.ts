// Pure CSV writing plus the two domain row shapes the export routes stream. The
// inverse of parseCsv in csv-import.ts: RFC-4180 quoting, then the contact /
// company row mappers. Kept DB-free so the escaping and column order are
// unit-tested without a database — the routes add auth, tenant scoping (withOrg)
// and the human status label, then hand the string to csvAttachmentResponse.

import { slugify } from "@/lib/slug";

// A cell needs quoting when it holds a comma, double-quote, CR or LF.
const CSV_ESCAPE_RE = /[",\r\n]/;

/// PURE: quote a single cell when it contains a comma, double-quote, CR or LF,
/// doubling any embedded quote (RFC 4180). Null/undefined/number coerce to text;
/// nullish becomes an empty cell.
export function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return CSV_ESCAPE_RE.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/// PURE: join a header row + data rows into one CSV document with CRLF line
/// endings (the RFC-4180 default that Excel and Google Sheets both read).
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/// PURE: a Date as a plain YYYY-MM-DD cell (empty when absent).
function isoDay(date: Date | null): string {
  return date == null ? "" : date.toISOString().slice(0, 10);
}

/// PURE: a string[] as one cell, semicolon-separated so it survives a CSV import
/// (commas inside a cell would otherwise need re-quoting to stay one column).
function joinList(values: string[]): string {
  return values.join("; ");
}

// ── Contacts ────────────────────────────────────────────────────────────────
export const CONTACT_CSV_HEADERS = [
  "Name",
  "Title",
  "Company",
  "Email",
  "Phone",
  "LinkedIn",
  "Tags",
  "Primary contact",
];

export type ContactCsvInput = {
  name: string;
  title: string | null;
  companyName: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  tags: string[];
  isPrimary: boolean;
};

/// PURE: one contact → a CSV row in CONTACT_CSV_HEADERS order.
export function contactCsvRow(c: ContactCsvInput): string[] {
  return [
    c.name,
    c.title ?? "",
    c.companyName,
    c.email ?? "",
    c.phone ?? "",
    c.linkedin ?? "",
    joinList(c.tags),
    c.isPrimary ? "Yes" : "No",
  ];
}

// ── Companies ───────────────────────────────────────────────────────────────
export const COMPANY_CSV_HEADERS = [
  "Name",
  "Status",
  "Tier",
  "Industry",
  "Counties",
  "Annual value",
  "Owner",
  "Website",
  "LinkedIn",
  "Last contact",
  "Member since",
];

export type CompanyCsvInput = {
  name: string;
  status: string; // human label (the route maps the stored code first)
  tier: string | null;
  industry: string;
  counties: string[];
  annualValue: number;
  ownerName: string | null;
  website: string | null;
  linkedin: string | null;
  lastContactAt: Date | null;
  memberSince: number | null;
};

/// PURE: one company → a CSV row in COMPANY_CSV_HEADERS order. Annual value is the
/// raw number (no "$"/commas) so the column stays numeric in a spreadsheet.
export function companyCsvRow(c: CompanyCsvInput): string[] {
  return [
    c.name,
    c.status,
    c.tier ?? "",
    c.industry,
    joinList(c.counties),
    String(c.annualValue),
    c.ownerName ?? "",
    c.website ?? "",
    c.linkedin ?? "",
    isoDay(c.lastContactAt),
    c.memberSince == null ? "" : String(c.memberSince),
  ];
}

// ── Download response ─────────────────────────────────────────────────────────
/// A finished CSV string as a browser download: a leading UTF-8 BOM (so Excel
/// reads accented names), the text/csv attachment headers, and a dated,
/// org-slugged filename (`<prefix>-<org>-<YYYY-MM-DD>.csv`). no-store since each
/// export is a fresh per-request snapshot. Shared by the export routes.
export function csvAttachmentResponse(
  prefix: string,
  orgName: string,
  csv: string,
): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${prefix}-${slugify(orgName)}-${stamp}.csv`;
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
