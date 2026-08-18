// The role a company can hold on a project (the project_links role vocabulary,
// per schema §3.7). Shared by the project detail page's "Link a company" form
// and the company profile's "Link a project" form so the two link surfaces stay
// in lockstep. PURE — no DB, no secrets.
//
// The dropdown offers a combined, grouped list: the high-level "stake" roles a
// company holds (Stakeholder) PLUS the professional disciplines a firm actually
// practices (Discipline). The discipline roles are drawn from the shared
// @/lib/disciplines vocabulary — the same values the open-role scan reads — so a
// linked discipline company (e.g. a general contractor) also marks that
// discipline filled on the project. Fixed vocabulary, identical for every tenant.
import { DISCIPLINES } from "@/lib/disciplines";

export type ProjectRoleOption = { value: string; label: string };
export type ProjectRoleGroup = {
  label: string;
  options: readonly ProjectRoleOption[];
};

// The five high-level participation roles a company holds on a project.
const STAKEHOLDER_ROLES: readonly ProjectRoleOption[] = [
  { value: "developer", label: "Developer" },
  { value: "lender", label: "Lender" },
  { value: "site_host", label: "Site host" },
  { value: "agency", label: "Agency" },
  { value: "advisor", label: "Advisor" },
];

const STAKEHOLDER_VALUES = new Set(STAKEHOLDER_ROLES.map((r) => r.value));

// The professional-team disciplines, sourced once from @/lib/disciplines and
// deduped against the stakeholder roles (e.g. `lender` already lives above).
const DISCIPLINE_ROLES: readonly ProjectRoleOption[] = DISCIPLINES.filter(
  (d) => !STAKEHOLDER_VALUES.has(d.value),
).map((d) => ({ value: d.value, label: d.label }));

// The grouped vocabulary the link-role <select> renders as two <optgroup>s.
export const PROJECT_LINK_ROLE_GROUPS: readonly ProjectRoleGroup[] = [
  { label: "Stakeholder", options: STAKEHOLDER_ROLES },
  { label: "Discipline", options: DISCIPLINE_ROLES },
];

const LABEL_BY_VALUE = new Map(
  PROJECT_LINK_ROLE_GROUPS.flatMap((g) => g.options).map((o) => [
    o.value,
    o.label,
  ]),
);

/// Whether a value is a known project-link role. Used at the linkCompany write
/// boundary to reject out-of-vocabulary roles before they persist.
export function isProjectLinkRole(value: string): boolean {
  return LABEL_BY_VALUE.has(value);
}

/// The display label for a role value, falling back to a humanized raw value so
/// legacy/unknown stored roles still render readably.
export function projectLinkRoleLabel(value: string): string {
  return (
    LABEL_BY_VALUE.get(value) ??
    value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
