// Org-configurable member tiers. Unlike Company.status (a fixed, app-wide
// vocabulary in company-statuses.ts), tiers are each org's own labels for the
// standing it grants its members — HVEDC uses Chairman / Director / Advisory,
// another org might use nothing at all. The list lives in Organization.settings
// JSON (settings.memberTiers) so it needs no table; this module is the single
// reader/normalizer both the settings editor and the write boundary speak
// through. Pure — no I/O — so it's trivially testable and safe in any layer.

// A tier label is free text (org's own vocabulary), but bounded so one bad
// paste can't bloat the JSON blob or the tier <select>.
const MAX_TIERS = 20;
const MAX_LABEL_LENGTH = 60;

// Normalize an arbitrary settings value into the tier list. Accepts the whole
// Organization.settings object (or anything) and reads its `memberTiers` array,
// trimming each entry, dropping blanks, de-duping case-insensitively (first
// spelling wins), and capping both label length and list size. Any shape that
// isn't a string array yields [] — an org with no tiers configured.
export function readMemberTiers(settings: unknown): string[] {
  const raw =
    settings != null &&
    typeof settings === "object" &&
    Array.isArray((settings as { memberTiers?: unknown }).memberTiers)
      ? ((settings as { memberTiers: unknown[] }).memberTiers)
      : [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const label = entry.trim().slice(0, MAX_LABEL_LENGTH);
    if (label === "") continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_TIERS) break;
  }
  return out;
}

// Normalize a submitted tier list (e.g. from the settings form) for storage —
// same rules as readMemberTiers, applied to a raw string[] rather than a
// settings object. Kept separate so callers reading vs. writing read clearly.
export function normalizeMemberTiers(tiers: string[]): string[] {
  return readMemberTiers({ memberTiers: tiers });
}
