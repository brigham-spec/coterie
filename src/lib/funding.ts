// Canonical funding-source vocabulary. A FundingSource's `category` and `status`
// are string columns, not tables, but the app speaks one vocabulary — defined
// here once and reused by the funding card's selects and the write-boundary
// validation in the server actions (mirrors @/lib/value-kinds). The values are
// the prototype's display-form strings (Coterie.html:10264), which is also the
// exact vocabulary the AI Suggest engine returns, so a suggestion can be tracked
// without translation. `tone` maps each to a StatusBadge palette class-set.

export type FundingCategoryDef = { value: string; label: string; tone: string };
export type FundingStatusDef = { value: string; label: string; tone: string };

export const FUNDING_CATEGORY_DEFS: readonly FundingCategoryDef[] = [
  { value: "Grant", label: "Grant", tone: "gold" },
  { value: "Loan", label: "Loan", tone: "teal" },
  { value: "Tax Benefit", label: "Tax Benefit", tone: "purple" },
  { value: "Bond", label: "Bond", tone: "slate" },
  { value: "Equity", label: "Equity", tone: "amber" },
];

export const FUNDING_STATUS_DEFS: readonly FundingStatusDef[] = [
  { value: "Identified", label: "Identified", tone: "slate" },
  { value: "Researching", label: "Researching", tone: "amber" },
  { value: "Applied", label: "Applied", tone: "gold" },
  { value: "Awarded", label: "Awarded", tone: "teal" },
  { value: "Declined", label: "Declined", tone: "red" },
];

export const FUNDING_CATEGORIES: readonly string[] = FUNDING_CATEGORY_DEFS.map(
  (c) => c.value,
);
export const FUNDING_STATUSES: readonly string[] = FUNDING_STATUS_DEFS.map(
  (s) => s.value,
);

const CATEGORY_VALUES = new Set(FUNDING_CATEGORIES);
const STATUS_VALUES = new Set(FUNDING_STATUSES);

/// Whether a value is a known funding category. Used at the write boundary to
/// reject forged/out-of-vocabulary values before they persist.
export function isFundingCategory(value: string): boolean {
  return CATEGORY_VALUES.has(value);
}

/// Whether a value is a known funding status. Used at the write boundary to
/// reject forged/out-of-vocabulary values before they persist.
export function isFundingStatus(value: string): boolean {
  return STATUS_VALUES.has(value);
}
