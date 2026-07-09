// Canonical company lifecycle vocabulary. A Company's `status` is a string field,
// not a table, but the app speaks one vocabulary — defined here once and reused by
// the create form's status select, the /companies segment tabs, the prospect
// finder's in-network filter, and the write-boundary validation in the server
// actions. Values are snake_case (the app convention); labels are the display form.
// Badge colors live in @/components/ui StatusBadge (keyed by these same values).

export type CompanyStatusDef = { value: string; label: string };

export const COMPANY_STATUS_DEFS: readonly CompanyStatusDef[] = [
  { value: "prospect", label: "Prospect" },
  { value: "member", label: "Member" },
  { value: "strategic_partner", label: "Strategic Partner" },
  { value: "former", label: "Former" },
];

export const COMPANY_STATUSES: readonly string[] = COMPANY_STATUS_DEFS.map(
  (s) => s.value,
);

/// In-network statuses — companies that are an active part of the network
/// (members + strategic partners), as opposed to prospects or former relationships.
export const NETWORK_STATUSES: readonly string[] = ["member", "strategic_partner"];

const VALUES = new Set(COMPANY_STATUSES);

/// Whether a value is a known company status. Used at the write boundary to reject
/// forged/out-of-vocabulary values before they persist.
export function isCompanyStatus(value: string): boolean {
  return VALUES.has(value);
}
