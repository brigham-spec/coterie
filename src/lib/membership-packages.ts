// Org-configurable membership packages: the sellable offerings an org proposes
// to members and prospects — a name, an optional annual price, a short
// positioning line, and the list of services each package includes. This is a
// DIFFERENT axis from member-tiers.ts: member tiers are the standing an org
// grants an existing member (a classification, auto-assignable from annual
// value); packages are what an org SELLS. Proposals and (later) the proposal /
// value-prop generators draw their tier name, price, and included-services copy
// from here. Stored in Organization.settings JSON (settings.membershipPackages)
// so it needs no table; this module is the single reader/normalizer both the
// settings editor and the write boundary speak through. Pure — no I/O — so it's
// trivially testable and safe in any layer.

// Bounds so one bad paste can't bloat the settings JSON blob. Exported so the
// editor can show the same caps it enforces on write.
export const MAX_PACKAGES = 12;
export const MAX_NAME_LENGTH = 80;
export const MAX_SUMMARY_LENGTH = 280;
export const MAX_SERVICES = 20;
export const MAX_SERVICE_LENGTH = 160;

// One sellable package. `annualPrice` null means "custom / on request" — an org
// that quotes per-member leaves it blank. `summary` may be "" (no positioning
// line). `includedServices` is a cleaned bullet list (may be empty).
export type MembershipPackage = {
  name: string;
  annualPrice: number | null;
  summary: string;
  includedServices: string[];
};

// Clean a raw service-bullet list: coerce to strings, trim, cap each line's
// length, drop blanks, and cap the list. Non-array input yields [].
function coerceServices(entry: unknown): string[] {
  if (!Array.isArray(entry)) return [];
  const out: string[] = [];
  for (const raw of entry) {
    if (typeof raw !== "string") continue;
    const line = raw.trim().slice(0, MAX_SERVICE_LENGTH);
    if (line === "") continue;
    out.push(line);
    if (out.length >= MAX_SERVICES) break;
  }
  return out;
}

// Coerce one settings entry into a clean package, or null to drop it. A
// blank/missing name drops the whole package; a non-finite or negative price
// collapses to null (custom); summary defaults to "".
function coercePackage(entry: unknown): MembershipPackage | null {
  if (entry == null || typeof entry !== "object") return null;
  const rec = entry as {
    name?: unknown;
    annualPrice?: unknown;
    summary?: unknown;
    includedServices?: unknown;
  };
  if (typeof rec.name !== "string") return null;
  const name = rec.name.trim().slice(0, MAX_NAME_LENGTH);
  if (name === "") return null;
  const annualPrice =
    typeof rec.annualPrice === "number" &&
    Number.isFinite(rec.annualPrice) &&
    rec.annualPrice >= 0
      ? rec.annualPrice
      : null;
  const summary =
    typeof rec.summary === "string"
      ? rec.summary.trim().slice(0, MAX_SUMMARY_LENGTH)
      : "";
  return {
    name,
    annualPrice,
    summary,
    includedServices: coerceServices(rec.includedServices),
  };
}

// Normalize an arbitrary settings value into the packages. Accepts the whole
// Organization.settings object (or anything) and reads its `membershipPackages`
// array, coercing each entry, dropping blanks, de-duping by name
// case-insensitively (first spelling wins), and capping list size. Any shape
// that isn't an array yields [] — an org with no packages configured.
export function readMembershipPackages(settings: unknown): MembershipPackage[] {
  const raw =
    settings != null &&
    typeof settings === "object" &&
    Array.isArray((settings as { membershipPackages?: unknown }).membershipPackages)
      ? (settings as { membershipPackages: unknown[] }).membershipPackages
      : [];

  const out: MembershipPackage[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const pkg = coercePackage(entry);
    if (pkg === null) continue;
    const key = pkg.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pkg);
    if (out.length >= MAX_PACKAGES) break;
  }
  return out;
}

// Normalize a submitted package list (e.g. from the settings form) for storage —
// same rules as readMembershipPackages, applied to a raw array rather than a
// settings object. Kept separate so callers reading vs. writing read clearly.
export function normalizeMembershipPackages(
  packages: MembershipPackage[],
): MembershipPackage[] {
  return readMembershipPackages({ membershipPackages: packages });
}
