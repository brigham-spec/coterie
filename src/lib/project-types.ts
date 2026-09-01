// Project construction-type vocabulary for the project add + edit forms. A
// project may combine several types (e.g. new construction that includes a
// modular component), so the forms render these as a multi-select checkbox
// group and the selection is stored as a comma-joined string in the single
// `type` text column — no schema change. Parsing is tolerant of legacy free-text
// values already on record; serializing keeps only the known vocabulary so the
// stored value stays clean.
export const PROJECT_TYPES = [
  "New Construction",
  "Adaptive Reuse",
  "Historic Renovation",
  "Gut Rehabilitation",
  "Modular / Prefab",
  "Warehouse / Distribution",
  "Mixed-Use",
  "Expansion / Addition",
  "Tenant Improvement",
  "Infrastructure / Site Work",
] as const;

const TYPE_SET = new Set<string>(PROJECT_TYPES);

/// PURE: split a stored `type` string into its individual values — trimmed, with
/// empties dropped and duplicates removed (case-insensitively, first kept). Order
/// is preserved so the edit form can pre-check the project's current types.
/// Tolerant of legacy free-text values that predate the fixed vocabulary.
export function parseProjectTypes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v === "" || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/// PURE: coerce a form's selected type values to the clean stored form — keep only
/// the known vocabulary (the checkboxes can only emit these, so anything else is a
/// tampered payload), dedupe in vocabulary order, and join with ", ". Returns ""
/// when nothing valid was selected (the caller stores that as null).
export function serializeProjectTypes(values: string[]): string {
  const chosen = new Set(values.map((v) => v.trim()).filter((v) => TYPE_SET.has(v)));
  return PROJECT_TYPES.filter((t) => chosen.has(t)).join(", ");
}
