// What the project is asking the org to help with — an intake/needs signal
// distinct from HVEDC Services (@/lib/hv-services), which tracks the lines the org
// is actively delivering plus their fees. This is the ask: source equity, file a
// CFA, navigate an IDA/PILOT, pursue grants, work through entitlements, etc. Stored
// as a flat list of keys on Project.assistanceRequested (a String[] column). PURE —
// no DB, no server-only; the parser reads anything missing / malformed as empty.

export type AssistanceKey =
  | "equity_sourcing"
  | "debt_financing"
  | "grants"
  | "cfa_application"
  | "ida_navigation"
  | "entitlement_navigation"
  | "tax_incentives"
  | "site_selection"
  | "workforce"
  | "advocacy"
  | "other";

export type AssistanceDef = { key: AssistanceKey; label: string; desc: string };

// The assistance a project can request, in display order.
export const ASSISTANCE_DEFS: readonly AssistanceDef[] = [
  {
    key: "equity_sourcing",
    label: "Equity Sourcing",
    desc: "Looking for an equity partner or co-investor",
  },
  {
    key: "debt_financing",
    label: "Debt / Financing",
    desc: "Needs construction, bridge, or permanent debt",
  },
  {
    key: "grants",
    label: "Grants",
    desc: "Pursuing grant funding for the project",
  },
  {
    key: "cfa_application",
    label: "CFA Application",
    desc: "Help preparing or filing a Consolidated Funding Application",
  },
  {
    key: "ida_navigation",
    label: "IDA / PILOT Navigation",
    desc: "Navigating an IDA application or PILOT negotiation",
  },
  {
    key: "entitlement_navigation",
    label: "Entitlement Navigation",
    desc: "Working through zoning, entitlements, or planning-board approvals",
  },
  {
    key: "tax_incentives",
    label: "Tax Incentives",
    desc: "Identifying tax credits, abatements, or other incentives",
  },
  {
    key: "site_selection",
    label: "Site Selection",
    desc: "Finding or evaluating a site or property",
  },
  {
    key: "workforce",
    label: "Workforce / Talent",
    desc: "Hiring, training, or workforce-pipeline support",
  },
  {
    key: "advocacy",
    label: "Government Advocacy",
    desc: "Legislative, regulatory, or agency relationship support",
  },
  {
    key: "other",
    label: "Other",
    desc: "Another kind of assistance not listed above",
  },
];

const BY_KEY: ReadonlyMap<string, AssistanceDef> = new Map(
  ASSISTANCE_DEFS.map((d) => [d.key, d]),
);

// The closed set of assistance keys — the vocabulary every write is filtered to.
export const ASSISTANCE_KEY_SET: ReadonlySet<string> = new Set(
  ASSISTANCE_DEFS.map((d) => d.key),
);

export function isAssistanceKey(v: string): v is AssistanceKey {
  return ASSISTANCE_KEY_SET.has(v);
}

/// Resolve an assistance key to its definition. Unknown keys (from evolving data)
/// fall back to a definition carrying the raw key as its label.
export function getAssistanceDef(key: string): AssistanceDef {
  return (
    BY_KEY.get(key) ?? { key: key as AssistanceKey, label: key, desc: "" }
  );
}

/// Coerce a project's assistanceRequested value into the recognized keys, in
/// display order and de-duped. A missing / malformed value reads as empty.
export function parseAssistanceKeys(raw: unknown): AssistanceKey[] {
  const selected = new Set<string>(
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [],
  );
  return ASSISTANCE_DEFS.filter((d) => selected.has(d.key)).map((d) => d.key);
}
