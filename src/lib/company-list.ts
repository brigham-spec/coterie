// Companies list-view intelligence (slice S11a, ported from the prototype's
// member-row badges, Coterie.html ~L4308-4320). Pure, DB-free derivations the
// companies table renders per row: how stale the last contact is (color bucket),
// how many open action items are attributed to a company, and how many
// introductions it's a party to. The page loads the rows withOrg and hands them
// here so the thresholds and attribution stay unit-tested without a database.

import { categorizeIndustry } from "@/lib/industry-categories";

const DAY = 86_400_000;

// The companies-table sort model — a FIELD (which column) plus a DIRECTION. One
// source shared by the filter's <select> (the field labels) and the page's sort
// comparator + clickable column headers, so they can't drift apart. Each field
// carries the natural direction to use when it's first chosen (name ascending,
// value/date/contact descending); clicking an already-active header flips it.
export type CompanySortField =
  | "name"
  | "owner"
  | "tier"
  | "value"
  | "recent"
  | "actions"
  | "added";
export type CompanySortDir = "asc" | "desc";

export const COMPANY_SORT_OPTIONS: {
  value: CompanySortField;
  label: string;
  defaultDir: CompanySortDir;
}[] = [
  { value: "name", label: "Name", defaultDir: "asc" },
  { value: "owner", label: "Owner", defaultDir: "asc" },
  { value: "tier", label: "Tier", defaultDir: "asc" },
  { value: "value", label: "Value", defaultDir: "desc" },
  { value: "recent", label: "Last contact", defaultDir: "desc" },
  { value: "actions", label: "Open actions", defaultDir: "desc" },
  { value: "added", label: "Date added", defaultDir: "desc" },
];

const SORT_FIELDS = new Map(COMPANY_SORT_OPTIONS.map((o) => [o.value, o]));

// Legacy single-value sorts (before the field+dir split) → their equivalent
// field/direction, so an old shared URL keeps working.
const LEGACY_SORT: Record<string, { field: CompanySortField; dir: CompanySortDir }> = {
  newest: { field: "added", dir: "desc" },
  oldest: { field: "added", dir: "asc" },
};

/// PURE: resolve the raw `sort`/`dir` query params into a valid field +
/// direction. An unknown field falls back to name; a missing/invalid direction
/// falls back to the field's natural default. Kept here (not in the page) so the
/// parsing stays unit-testable and the default directions live with the options.
export function parseCompanySort(
  rawSort: string,
  rawDir: string,
): { field: CompanySortField; dir: CompanySortDir } {
  const legacy = LEGACY_SORT[rawSort];
  if (legacy) return legacy;
  const opt = SORT_FIELDS.get(rawSort as CompanySortField);
  const field: CompanySortField = opt ? opt.value : "name";
  const defaultDir = opt?.defaultDir ?? "asc";
  const dir: CompanySortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir;
  return { field, dir };
}

export function defaultSortDir(field: CompanySortField): CompanySortDir {
  return SORT_FIELDS.get(field)?.defaultDir ?? "asc";
}

// Last-contact staleness bucket — red past 90 days, amber past 60, green when
// fresh, and "none" when there's no recorded contact. Mirrors the dashboard's
// Needs-a-Call coloring (>90d red) extended with the prototype's 60-day amber.
export type StaleTone = "fresh" | "warm" | "stale" | "none";

export function staleTone(date: Date | null, now: Date): StaleTone {
  if (date == null) return "none";
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  if (days > 90) return "stale";
  if (days > 60) return "warm";
  return "fresh";
}

// An action item reduced to how it attributes to a company: a manual commitment
// carries companyId directly; a "they owe" item is attributed through the owing
// contact's company. Exactly one path applies (companyId wins if both present).
export type ActionAttrRow = {
  companyId: string | null;
  ownerContact: { companyId: string } | null;
};

export function tallyOpenActionsByCompany(
  rows: ActionAttrRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const companyId = row.companyId ?? row.ownerContact?.companyId ?? null;
    if (companyId != null)
      counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }
  return counts;
}

// An introduction reduced to its two parties' companies. A company is credited
// once per intro even if (degenerately) both parties share it.
export type IntroAttrRow = {
  partyA: { companyId: string };
  partyB: { companyId: string };
};

export function tallyIntrosByCompany(rows: IntroAttrRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const ids =
      row.partyA.companyId === row.partyB.companyId
        ? [row.partyA.companyId]
        : [row.partyA.companyId, row.partyB.companyId];
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ── List filtering (shared by the companies page + the CSV export route) ──────
// One source for the status tabs and the row filter so the page you're viewing
// and the file you export can never drift apart. `statuses: null` is the
// catch-all "All" tab.
export const COMPANY_SEGMENTS: {
  key: string;
  label: string;
  statuses: string[] | null;
}[] = [
  { key: "all", label: "All", statuses: null },
  { key: "members", label: "Members", statuses: ["member"] },
  { key: "partners", label: "Partners", statuses: ["strategic_partner"] },
  { key: "prospects", label: "Prospects", statuses: ["prospect"] },
  { key: "former", label: "Former", statuses: ["former"] },
];

const SEGMENT_BY_KEY = new Map(COMPANY_SEGMENTS.map((s) => [s.key, s]));

/// PURE: whether a company status belongs to a segment tab. An unknown segment
/// key falls back to "All" (matches everything).
export function companySegmentMatches(segmentKey: string, status: string): boolean {
  const seg = SEGMENT_BY_KEY.get(segmentKey) ?? COMPANY_SEGMENTS[0];
  return seg.statuses == null || seg.statuses.includes(status);
}

// The active list filters, pre-resolved from the URL query string. `q` is already
// trimmed + lowercased; `owner` is "all"/"" (everyone) or a user id; `industry` is
// a rolled-up category label; `likelihood` is a 1-5 floor (0 = off).
export type CompanyFilter = {
  segment: string;
  q: string;
  owner: string;
  tag: string;
  tier: string;
  industry: string;
  likelihood: number;
};

type FilterableCompany = {
  name: string;
  status: string;
  industry: string;
  ownerUserId: string | null;
  networkTags: string[];
  tier: string | null;
  likelihood: number | null;
};

/// PURE: apply the active filters to a loaded company set. Mirrors the companies
/// page's in-memory predicate chain exactly so an export matches the view.
export function filterCompanies<T extends FilterableCompany>(
  companies: T[],
  f: CompanyFilter,
): T[] {
  return companies.filter((c) => {
    if (!companySegmentMatches(f.segment, c.status)) return false;
    if (
      f.q !== "" &&
      !c.name.toLowerCase().includes(f.q) &&
      !c.industry.toLowerCase().includes(f.q)
    )
      return false;
    if (f.owner !== "" && f.owner !== "all" && c.ownerUserId !== f.owner)
      return false;
    if (f.tag !== "" && !c.networkTags.includes(f.tag)) return false;
    if (f.tier !== "" && c.tier !== f.tier) return false;
    if (
      f.industry !== "" &&
      !(c.industry !== "" && categorizeIndustry(c.industry) === f.industry)
    )
      return false;
    if (f.likelihood > 0 && (c.likelihood ?? 0) < f.likelihood) return false;
    return true;
  });
}
