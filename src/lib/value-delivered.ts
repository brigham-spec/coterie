// Per-company Value Delivered rollup (slice P4). PURE — no DB, no server-only:
// the profile page loads a company's value_delivered rows inside withOrg
// (RLS-scoped) and hands plain typed entries here; this module does the summary
// math so it's exhaustively unit-testable (mirrors @/lib/value-created, which is
// the org-wide counterpart). Amounts are nullable — some value is non-monetary
// (a warm intro with no attached dollar figure), so those count toward the entry
// tally but contribute 0 to the dollar total.

import { introStageRank } from "@/lib/intro-stages";
import { isAttending, RSVP_ATTENDED } from "@/lib/event-stages";

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
  entries: readonly Pick<ValueDeliveredEntry, "kind" | "amount">[],
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

// ── Derived value (Phase 1, read-only) ──────────────────────────────────────
// The manual ValueDelivered ledger is the explicit, dollar-tagged record staff
// keep. But real membership value also shows up implicitly across the network:
// introductions the member was a party to, events they attended, projects they
// collaborated on. This layer DERIVES those into the same ValueDeliveredEntry
// shape so the report reflects the full picture — never a bare "$0" when the
// network has clearly been working for the member. Derived entries carry no
// dollar figure (amount = null): they count as wins and chart by volume, but we
// never invent a monetary value that wasn't recorded.

/// An introduction only counts as delivered value once it has actually been
/// made — earlier stages (suggested / drafted) are still pipeline, not a
/// realized win. Reuses the canonical lifecycle rank so this agrees with the
/// pipeline's "made-onward" test (introductions/page.tsx) and tolerates legacy
/// values (which rank last, i.e. beyond made).
export function isRealizedIntroStatus(status: string): boolean {
  return introStageRank(status) >= introStageRank("made");
}

export type DerivedIntro = {
  introId: string;
  status: string;
  headline: string;
  outcome: string | null;
  madeOn: Date | null;
  createdAt: Date;
  partyAName: string;
  partyBName: string;
  /// The other party's company (the member was introduced TO), when known.
  counterpartCompany: string | null;
};

export type DerivedEvent = {
  inviteeId: string;
  eventName: string;
  rsvp: string;
  /// event.date, or the invitee's createdAt when the event has no date.
  occurredAt: Date;
};

export type DerivedCollaboration = {
  projectId: string;
  projectName: string;
  /// Team role on the project (snake_case vocabulary).
  role: string;
  occurredAt: Date;
};

export type DerivedInputs = {
  intros: DerivedIntro[];
  events: DerivedEvent[];
  collaborations: DerivedCollaboration[];
  /// introductionIds already represented by a manual ledger row — suppressed
  /// from the derived layer so an intro is never counted twice (manual wins).
  ledgerIntroIds: Set<string>;
};

/// Shape a member's network activity into derived value entries (Phase 1,
/// read-only). Only realized activity counts (intro made+, event attended/
/// confirmed); intros already in the manual ledger are dropped so nothing is
/// double-counted. All derived entries are non-monetary (amount = null).
export function deriveValueEntries(input: DerivedInputs): ValueDeliveredEntry[] {
  const entries: ValueDeliveredEntry[] = [];

  for (const i of input.intros) {
    if (!isRealizedIntroStatus(i.status)) continue;
    if (input.ledgerIntroIds.has(i.introId)) continue;
    const summary =
      i.headline.trim() ||
      (i.counterpartCompany
        ? `Introduced to ${i.counterpartCompany}`
        : "Introduction made");
    entries.push({
      id: `derived-intro-${i.introId}`,
      kind: "introduction",
      amount: null,
      summary,
      outcome: i.outcome ?? "",
      occurredAt: i.madeOn ?? i.createdAt,
      introLabel: `${i.partyAName} \u2194 ${i.partyBName}`,
    });
  }

  for (const e of input.events) {
    if (!isAttending(e.rsvp)) continue;
    const verb = e.rsvp === RSVP_ATTENDED ? "Attended" : "Confirmed for";
    entries.push({
      id: `derived-event-${e.inviteeId}`,
      kind: "event",
      amount: null,
      summary: `${verb} ${e.eventName}`,
      outcome: "",
      occurredAt: e.occurredAt,
      introLabel: null,
    });
  }

  for (const c of input.collaborations) {
    entries.push({
      id: `derived-collab-${c.projectId}`,
      kind: "other",
      amount: null,
      summary: `Collaborating on ${c.projectName}`,
      outcome: c.role ? `Role: ${c.role.replace(/_/g, " ")}` : "",
      occurredAt: c.occurredAt,
      introLabel: null,
    });
  }

  return entries;
}

/// The ROI story: how many times over the realized dollar value returned the
/// member's annual dues. Null when either side is zero — no dues, or no
/// dollar-tagged value yet, means no honest multiplier to show.
export function roiMultiplier(
  realizedValue: number,
  annualValue: number,
): number | null {
  return realizedValue > 0 && annualValue > 0
    ? realizedValue / annualValue
    : null;
}

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

export type IntroValueSplit = {
  /// The introductions themselves — the network connection made (non-monetary).
  introsMade: ValueDeliveredEntry[];
  /// Monetary wins attributed BACK to an introduction (the contract/grant the
  /// member won because of a connection we made). These carry both an amount and
  /// the introLabel of the introduction they trace to.
  winsFromIntros: ValueDeliveredEntry[];
  /// Everything else — value delivered that isn't an intro and isn't traced to one.
  otherValue: ValueDeliveredEntry[];
  /// Sum of the wins-from-intros amounts (the dollars the network directly returned).
  winsTotal: number;
};

/// Split a company's value entries into the three-part story the meeting brief
/// leads with: the introductions we MADE, the monetary wins the member landed
/// FROM those introductions (a contract traced to an intro via introductionId →
/// introLabel), and any other value. PURE — each list is ordered newest-first so
/// the printed brief is stable. An intro that itself carries a dollar figure stays
/// in introsMade (kind wins); only downstream, intro-linked monetary rows count as
/// "wins from intros" so the two figures never double-count.
export function splitIntroValue(
  entries: readonly ValueDeliveredEntry[],
): IntroValueSplit {
  const introsMade: ValueDeliveredEntry[] = [];
  const winsFromIntros: ValueDeliveredEntry[] = [];
  const otherValue: ValueDeliveredEntry[] = [];
  let winsTotal = 0;

  for (const e of entries) {
    if (e.kind === "introduction") {
      introsMade.push(e);
    } else if (e.introLabel != null && e.amount != null) {
      winsFromIntros.push(e);
      winsTotal += e.amount;
    } else {
      otherValue.push(e);
    }
  }

  const newestFirst = (a: ValueDeliveredEntry, b: ValueDeliveredEntry) =>
    b.occurredAt.getTime() - a.occurredAt.getTime();
  introsMade.sort(newestFirst);
  winsFromIntros.sort(newestFirst);
  otherValue.sort(newestFirst);

  return { introsMade, winsFromIntros, otherValue, winsTotal };
}
