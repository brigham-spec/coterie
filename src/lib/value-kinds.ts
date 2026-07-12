// Canonical Value Delivered kinds. A ValueDelivered's `kind` is a string column,
// not a table, but the app speaks one vocabulary — defined here once and reused by
// the value card's kind select and the write-boundary validation in the server
// actions (mirrors @/lib/proposal-statuses). "introduction" is the flagship kind
// (a network intro that bore fruit); the rest cover the other ways the network
// delivers value. Labels are the display form; badge colors live in @/components/ui
// StatusBadge keyed by these same values.

export type ValueKindDef = { value: string; label: string };

export const VALUE_KIND_DEFS: readonly ValueKindDef[] = [
  { value: "introduction", label: "Introduction" },
  { value: "service", label: "Service" },
  { value: "grant", label: "Grant" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
];

export const VALUE_KINDS: readonly string[] = VALUE_KIND_DEFS.map((k) => k.value);

const VALUES = new Set(VALUE_KINDS);

/// Whether a value is a known value-delivered kind. Used at the write boundary to
/// reject forged/out-of-vocabulary values before they persist.
export function isValueKind(value: string): boolean {
  return VALUES.has(value);
}
