// Org-configurable member tiers. Unlike Company.status (a fixed, app-wide
// vocabulary in company-statuses.ts), tiers are each org's own labels for the
// standing it grants its members — HVEDC uses Chairman / Director / Advisory,
// another org might use nothing at all. The list lives in Organization.settings
// JSON (settings.memberTiers) so it needs no table; this module is the single
// reader/normalizer both the settings editor and the write boundary speak
// through. Pure — no I/O — so it's trivially testable and safe in any layer.

// A tier label is free text (org's own vocabulary), but bounded so one bad
// paste can't bloat the JSON blob or the tier <select>. Exported so the editor
// can show the same caps it enforces on write.
export const MAX_TIERS = 20;
export const MAX_LABEL_LENGTH = 60;

// A tier can optionally carry a minimum annual value: the sliding threshold that
// auto-assigns a member's tier from Company.annualValue on save (S7). `minValue`
// null means the tier is unranked — it never participates in auto-assignment and
// can only be set by hand. Legacy settings stored tiers as bare strings; those
// read back as unranked defs so nothing pre-threshold breaks.
export type MemberTier = { label: string; minValue: number | null };

// Coerce one settings entry (legacy string or {label, minValue} object) into a
// clean {label, minValue}, or null to drop it. A blank/over-long label is
// dropped; a non-finite or negative minValue collapses to null (unranked).
function coerceTierDef(entry: unknown): MemberTier | null {
  if (typeof entry === "string") {
    const label = entry.trim().slice(0, MAX_LABEL_LENGTH);
    return label === "" ? null : { label, minValue: null };
  }
  if (entry != null && typeof entry === "object") {
    const rec = entry as { label?: unknown; minValue?: unknown };
    if (typeof rec.label !== "string") return null;
    const label = rec.label.trim().slice(0, MAX_LABEL_LENGTH);
    if (label === "") return null;
    const min =
      typeof rec.minValue === "number" && Number.isFinite(rec.minValue) && rec.minValue >= 0
        ? rec.minValue
        : null;
    return { label, minValue: min };
  }
  return null;
}

// Normalize an arbitrary settings value into the tier defs. Accepts the whole
// Organization.settings object (or anything) and reads its `memberTiers` array,
// coercing each entry, dropping blanks, de-duping by label case-insensitively
// (first spelling wins), and capping list size. Any shape that isn't an array
// yields [] — an org with no tiers configured.
export function readMemberTierDefs(settings: unknown): MemberTier[] {
  const raw =
    settings != null &&
    typeof settings === "object" &&
    Array.isArray((settings as { memberTiers?: unknown }).memberTiers)
      ? (settings as { memberTiers: unknown[] }).memberTiers
      : [];

  const out: MemberTier[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const def = coerceTierDef(entry);
    if (def === null) continue;
    const key = def.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(def);
    if (out.length >= MAX_TIERS) break;
  }
  return out;
}

// Backward-compatible label reader: the tier <select> and list facets only need
// the ordered labels, so they keep calling this and stay oblivious to
// thresholds. Derived from readMemberTierDefs so both readers agree on ordering,
// caps, and de-duping.
export function readMemberTiers(settings: unknown): string[] {
  return readMemberTierDefs(settings).map((t) => t.label);
}

// Normalize a submitted def list (e.g. from the settings form) for storage —
// same rules as readMemberTierDefs, applied to a raw array rather than a settings
// object. Kept separate so callers reading vs. writing read clearly.
export function normalizeMemberTierDefs(tiers: MemberTier[]): MemberTier[] {
  return readMemberTierDefs({ memberTiers: tiers });
}

// Auto-assign the sliding tier for a member from its annual value: among the
// ranked defs (minValue != null) whose threshold the value clears, pick the
// highest threshold's label. Returns null when no ranked tier qualifies (the
// caller keeps the existing/hand-set tier in that case).
export function autoAssignTier(annualValue: number, defs: MemberTier[]): string | null {
  let best: MemberTier | null = null;
  for (const def of defs) {
    if (def.minValue === null) continue;
    if (def.minValue > annualValue) continue;
    if (best === null || def.minValue > best.minValue!) best = def;
  }
  return best?.label ?? null;
}
