// Per-company Value Delivered rollup (slice P4). PURE — no DB, no server-only:
// the profile page loads a company's value_delivered rows inside withOrg
// (RLS-scoped) and hands plain typed entries here; this module does the summary
// math so it's exhaustively unit-testable (mirrors @/lib/value-created, which is
// the org-wide counterpart). Amounts are nullable — some value is non-monetary
// (a warm intro with no attached dollar figure), so those count toward the entry
// tally but contribute 0 to the dollar total.

export type ValueDeliveredEntry = {
  id: string;
  kind: string;
  amount: number | null;
  summary: string;
  outcome: string;
  occurredAt: Date;
  /// Counterpart label when this entry links to an introduction, else null.
  introLabel: string | null;
};

export type ValueKindTally = { kind: string; count: number; amount: number };

export type ValueDeliveredSummary = {
  /// Sum of every entry's amount (nulls contribute 0).
  totalAmount: number;
  /// All entries, monetary or not.
  entryCount: number;
  /// Entries carrying a dollar figure.
  monetaryCount: number;
  /// Per-kind breakdown, richest first (amount desc, then count desc, then kind).
  byKind: ValueKindTally[];
};

/// Summarize a company's value-delivered entries into the totals + per-kind
/// breakdown the profile card renders. Ordering is deterministic so the visual
/// bars are stable across renders.
export function summarizeValueDelivered(
  entries: ValueDeliveredEntry[],
): ValueDeliveredSummary {
  let totalAmount = 0;
  let monetaryCount = 0;
  const tallies = new Map<string, ValueKindTally>();

  for (const e of entries) {
    if (e.amount != null) {
      totalAmount += e.amount;
      monetaryCount += 1;
    }
    const tally = tallies.get(e.kind) ?? { kind: e.kind, count: 0, amount: 0 };
    tally.count += 1;
    tally.amount += e.amount ?? 0;
    tallies.set(e.kind, tally);
  }

  const byKind = [...tallies.values()].sort(
    (a, b) =>
      b.amount - a.amount || b.count - a.count || a.kind.localeCompare(b.kind),
  );

  return {
    totalAmount,
    entryCount: entries.length,
    monetaryCount,
    byKind,
  };
}
