// Canonical professional-team roles for a project. A ProjectTeamMember's `role`
// is a string column, not a table, but the app speaks one vocabulary — defined
// here once and reused by the team card's role select and the write-boundary
// validation in the server actions (mirrors @/lib/value-kinds). Ported from the
// prototype's TEAM_ROLES list (Coterie.html:17665) so the development disciplines
// stay aligned with the rest of the app (see @/lib/disciplines for the intro
// matcher's parallel vocabulary). Labels are the display form.

export type TeamRoleDef = { value: string; label: string };

export const TEAM_ROLE_DEFS: readonly TeamRoleDef[] = [
  { value: "architect", label: "Architect" },
  { value: "design_architect", label: "Design Architect" },
  { value: "landscape_architect", label: "Landscape Architect" },
  { value: "civil_engineer", label: "Civil Engineer" },
  { value: "structural_engineer", label: "Structural Engineer" },
  { value: "mep_engineer", label: "MEP Engineer" },
  { value: "environmental", label: "Environmental Eng." },
  { value: "land_use_attorney", label: "Land Use Attorney" },
  { value: "permitting_consultant", label: "Permitting Consultant" },
  { value: "historic_preservation", label: "Historic Preservation" },
  { value: "traffic_engineer", label: "Traffic Engineer" },
  { value: "surveyor", label: "Surveyor" },
  { value: "lender", label: "Lender" },
  { value: "bridge_lender", label: "Bridge Lender" },
  { value: "equity_partner", label: "Equity Partner" },
  { value: "tax_credit_consultant", label: "Tax Credit Consultant" },
  { value: "general_contractor", label: "General Contractor" },
  { value: "interior_designer", label: "Interior Designer" },
  { value: "hospitality_operator", label: "Hospitality Operator" },
  { value: "owners_rep", label: "Owner's Rep" },
];

export const TEAM_ROLES: readonly string[] = TEAM_ROLE_DEFS.map((r) => r.value);

const VALUES = new Set(TEAM_ROLES);
const BY_VALUE = new Map(TEAM_ROLE_DEFS.map((r) => [r.value, r]));

/// Whether a value is a known team role. Used at the write boundary to reject
/// forged/out-of-vocabulary roles before they persist.
export function isTeamRole(value: string): boolean {
  return VALUES.has(value);
}

/// The display label for a role value, falling back to the raw value.
export function teamRoleLabel(value: string): string {
  return BY_VALUE.get(value)?.label ?? value;
}
