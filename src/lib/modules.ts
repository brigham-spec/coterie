// Per-org module registry — which dashboard sections a given tenant sees. PURE
// (no DB, no secrets), so it's safe to import anywhere and trivially testable.
//
// Data isolation is enforced by Postgres RLS; this is a different axis: product
// PACKAGING. Two paying tenants can run on one codebase with different surfaces —
// e.g. an economic-development org keeps Projects, a wealth-advisory firm drops
// it. A module maps 1:1 to a top-level nav destination (by href), so filtering the
// nav and guarding the route both key off the same registry.
//
// Enablement is stored in Organization.settings.modules as the list of ENABLED
// optional keys (core keys are always on and never stored). An ABSENT `modules`
// value means "all optional modules on" — the backward-compatible default, so an
// org that predates this feature (HVEDC) keeps its full surface. The list is
// curated by the platform operator, not the tenant (see settings/actions.ts).

export type ModuleKey =
  | "dashboard"
  | "companies"
  | "contacts"
  | "introductions"
  | "settings"
  | "revenue"
  | "proposals"
  | "projects"
  | "commitments"
  | "network_search"
  | "prospect_finder"
  | "linkedin"
  | "sop_assistant"
  | "news"
  | "email"
  | "events"
  | "meetings"
  | "invoices"
  | "value_created";

export type ModuleDef = {
  key: ModuleKey;
  /// Display label — matches the sidebar nav label for this destination.
  label: string;
  /// Primary nav href; the same value used in NAV_GROUPS. Nav filtering matches
  /// on this, so it must stay in lockstep with nav-items.ts.
  href: string;
  /// Core modules are always enabled and can't be toggled off (an org can't lock
  /// itself out of its own network).
  core: boolean;
};

// The full catalogue, in nav order. Core first within each domain grouping.
export const MODULES: readonly ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", core: true },
  { key: "revenue", label: "Revenue", href: "/dashboard/revenue", core: false },
  { key: "proposals", label: "Proposals", href: "/dashboard/proposals", core: false },
  { key: "companies", label: "Companies", href: "/dashboard/companies", core: true },
  { key: "contacts", label: "Contacts", href: "/dashboard/contacts", core: true },
  { key: "projects", label: "Projects", href: "/dashboard/projects", core: false },
  { key: "introductions", label: "Introductions", href: "/dashboard/introductions", core: true },
  { key: "commitments", label: "Commitments", href: "/dashboard/commitments", core: false },
  { key: "network_search", label: "Network Search", href: "/dashboard/network-search", core: false },
  { key: "prospect_finder", label: "Prospect Finder", href: "/dashboard/prospect-finder", core: false },
  { key: "linkedin", label: "LinkedIn", href: "/dashboard/linkedin", core: false },
  { key: "sop_assistant", label: "Document Assistant", href: "/dashboard/sop-assistant", core: false },
  { key: "news", label: "News", href: "/dashboard/news", core: false },
  { key: "email", label: "Email", href: "/dashboard/email", core: false },
  { key: "events", label: "Events", href: "/dashboard/events", core: false },
  { key: "meetings", label: "Meetings", href: "/dashboard/meetings", core: false },
  { key: "invoices", label: "Invoices", href: "/dashboard/invoices", core: false },
  { key: "value_created", label: "Value Created", href: "/dashboard/value-created", core: false },
  { key: "settings", label: "Settings", href: "/dashboard/settings", core: true },
];

export const OPTIONAL_MODULES: readonly ModuleDef[] = MODULES.filter((m) => !m.core);

const CORE_KEY_SET = new Set<ModuleKey>(MODULES.filter((m) => m.core).map((m) => m.key));
const OPTIONAL_KEY_SET = new Set<ModuleKey>(OPTIONAL_MODULES.map((m) => m.key));

/// Read the raw stored selection: the string list at settings.modules, or null
/// when unset (which the callers read as "all optional on").
function readModulesSetting(settings: unknown): string[] | null {
  if (settings != null && typeof settings === "object") {
    const m = (settings as { modules?: unknown }).modules;
    if (Array.isArray(m)) return m.filter((x): x is string => typeof x === "string");
  }
  return null;
}

/// The set of module keys enabled for an org, given its settings JSON. Core keys
/// are always present; optional keys come from the stored list, or all of them
/// when the list is absent (backward-compatible default).
export function enabledModuleKeys(settings: unknown): Set<ModuleKey> {
  const enabled = new Set<ModuleKey>(CORE_KEY_SET);
  const stored = readModulesSetting(settings);
  if (stored === null) {
    for (const k of OPTIONAL_KEY_SET) enabled.add(k);
  } else {
    const allow = new Set(stored);
    for (const k of OPTIONAL_KEY_SET) if (allow.has(k)) enabled.add(k);
  }
  return enabled;
}

/// Is one module enabled for an org? Core modules are always enabled regardless
/// of what's stored.
export function isModuleEnabled(settings: unknown, key: ModuleKey): boolean {
  if (CORE_KEY_SET.has(key)) return true;
  return enabledModuleKeys(settings).has(key);
}

/// The nav hrefs an org should see, in MODULES order — what the sidebar and
/// command palette render.
export function enabledNavHrefs(settings: unknown): string[] {
  const enabled = enabledModuleKeys(settings);
  return MODULES.filter((m) => enabled.has(m.key)).map((m) => m.href);
}

/// Normalize a submitted selection (operator toggle form) into the clean list to
/// store: only valid OPTIONAL keys, de-duped, in canonical MODULES order. Core
/// keys are dropped (always-on, never stored).
export function normalizeModuleSelection(keys: readonly string[]): ModuleKey[] {
  const chosen = new Set(keys);
  return OPTIONAL_MODULES.filter((m) => chosen.has(m.key)).map((m) => m.key);
}
