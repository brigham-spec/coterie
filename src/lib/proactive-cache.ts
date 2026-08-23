// Freshness policy for the proactive-scan cache (S6c, item 13). Pure + testable —
// the Urgent Signals panel renders a fresh cache instantly and only re-fires the AI
// scan once the snapshot has aged past the TTL. Mirrors the prototype's 4h window
// (Coterie.html:14568, `_fourHours = 4 * 3600000`).

/** How long a cached proactive scan is considered fresh (4 hours). */
export const PROACTIVE_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * True when a scan produced at `generatedAt` is still within the TTL relative to
 * `now`. A future timestamp (clock skew) counts as fresh; a missing timestamp does
 * not (caller should treat null as "no cache → scan").
 */
export function isProactiveCacheFresh(
  generatedAt: Date | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!generatedAt) return false;
  const age = now - generatedAt.getTime();
  return age < PROACTIVE_CACHE_TTL_MS;
}

/**
 * Compact human label for how long ago a cached scan was produced ("just now",
 * "12m ago", "3h ago"). Shared by the introductions panel and the dashboard's
 * possible-introductions panel so both read a snapshot's age the same way.
 */
export function relativeAge(fromMs: number, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - fromMs) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}
