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

export type ValueReportSection = {
  kind: string;
  /// Dollars attributed to this kind (nulls contribute 0).
  amount: number;
  /// Entries of this kind, monetary or not.
  count: number;
  /// This kind's entries, newest first.
  entries: ValueDeliveredEntry[];
};

export type ValueReport = {
  summary: ValueDeliveredSummary;
  /// Oldest / newest occurredAt across all entries — the report's period. Null
  /// when there are no entries.
  firstAt: Date | null;
  lastAt: Date | null;
  /// Entries grouped by kind, richest kind first (same order as summary.byKind).
  sections: ValueReportSection[];
};

/// Structure a company's value-delivered entries into the shareable report: the
/// same summary totals plus per-kind sections (richest first) and the covered
/// period. PURE — the report page loads the rows withOrg-scoped and hands them
/// here; keeping the shaping testable and free of DB/format concerns.
export function buildValueReport(entries: ValueDeliveredEntry[]): ValueReport {
  const summary = summarizeValueDelivered(entries);

  const byKind = new Map<string, ValueDeliveredEntry[]>();
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (const e of entries) {
    const bucket = byKind.get(e.kind) ?? [];
    bucket.push(e);
    byKind.set(e.kind, bucket);

    if (firstAt === null || e.occurredAt < firstAt) firstAt = e.occurredAt;
    if (lastAt === null || e.occurredAt > lastAt) lastAt = e.occurredAt;
  }

  const sections: ValueReportSection[] = summary.byKind.map((tally) => ({
    kind: tally.kind,
    amount: tally.amount,
    count: tally.count,
    entries: (byKind.get(tally.kind) ?? [])
      .slice()
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  }));

  return { summary, firstAt, lastAt, sections };
}
