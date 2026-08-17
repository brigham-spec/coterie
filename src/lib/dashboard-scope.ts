// Personal-vs-org scoping for the dashboard's tailored cards (Needs a Call,
// Daily Focus). Staff always see only their own work; admins can toggle between
// their own ("mine") and the whole org ("everyone"), defaulting to mine.
//
// PURE (no I/O): the same resolver runs on the page (from the ?scope search
// param) and inside the Daily Focus server action (from a hidden form field), so
// the clamp is the single source of truth — a staff user can never widen their
// view to the whole org by tampering with the request.

export type DashboardScope = "mine" | "everyone";

/// Resolve the effective scope. Admins honor an explicit "everyone" request and
/// fall back to "mine"; everyone else is pinned to "mine" regardless of what was
/// asked.
export function resolveScope(
  isAdmin: boolean,
  requested: string | undefined,
): DashboardScope {
  if (!isAdmin) return "mine";
  return requested === "everyone" ? "everyone" : "mine";
}
