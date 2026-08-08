// Referral leaderboard (parity gap Dashboard 10, prototype "ranks members by
// referrals made"). PURE — no I/O — so the dashboard card is directly testable.
// A company's `referredById` self-FK records who referred it; this tallies, per
// referrer, how many companies point back at them. Referrers are resolved
// against the same loaded company set so every entry has a name and a profile
// link — an id that doesn't resolve (e.g. referrer since deleted) is skipped.
// External referrers (`referredByExternal`, a free-text name) are out of scope:
// they aren't network members and have no profile to rank.

export interface ReferralCompany {
  id: string;
  name: string;
  referredById: string | null;
}

export interface ReferralLeaderboardEntry {
  id: string;
  name: string;
  count: number;
}

export function buildReferralLeaderboard(
  companies: readonly ReferralCompany[],
): ReferralLeaderboardEntry[] {
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const counts = new Map<string, number>();
  for (const c of companies) {
    if (c.referredById == null || !nameById.has(c.referredById)) continue;
    counts.set(c.referredById, (counts.get(c.referredById) ?? 0) + 1);
  }
  // Most referrals first; name breaks ties so the list is stable across renders.
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: nameById.get(id) as string, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
