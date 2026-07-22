// Defensive coercers for untyped Json read back from Postgres. economic_impact,
// hv_services, and similar columns are hand-entered / migrated, so values may
// arrive missing, malformed, or as strings. These read anything unusable as a
// zero / empty value rather than throwing. PURE — no DB, no server-only.

// Coerce an unknown Json value to a finite number, else 0. Accepts numeric strings.
export function numFromJson(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Coerce an unknown Json value to a trimmed string, else "".
export function strFromJson(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Coerce an unknown Json value to a plain object (not an array), else {}.
export function recordFromJson(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
