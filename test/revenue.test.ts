import { describe, expect, test } from "vitest";

import {
  computeRevenueSummary,
  type RevenueCompany,
  type RevenueInvoice,
  type RevenueProposal,
} from "@/lib/revenue";

// Pure-logic tests for the revenue rollup. NOW is fixed mid-2026 so calendar
// boundaries (year / this-month / next-month / quarter) are unambiguous.
const NOW = new Date(2026, 6, 15); // 15 Jul 2026 (month index 6 = Q3)

function inv(over: Partial<RevenueInvoice>): RevenueInvoice {
  return {
    id: over.id ?? "i1",
    companyName: over.companyName ?? "Acme",
    amount: over.amount ?? 0,
    paid: over.paid ?? 0,
    dueOn: over.dueOn ?? NOW,
    void: over.void ?? false,
    ...over,
  };
}

describe("computeRevenueSummary — collection + past due", () => {
  test("YTD collection rate caps collected at face value and excludes void", () => {
    const invoices: RevenueInvoice[] = [
      // Fully paid, due earlier this year → scheduled + collected.
      inv({ id: "a", amount: 1000, paid: 1000, dueOn: new Date(2026, 2, 1) }),
      // Overpaid, due earlier this year → collected capped at amount.
      inv({ id: "b", amount: 1000, paid: 1500, dueOn: new Date(2026, 3, 1) }),
      // Unpaid, due before today → scheduled but not collected, and past due.
      inv({ id: "c", amount: 500, paid: 0, dueOn: new Date(2026, 4, 1) }),
      // Void, due before today → ignored everywhere.
      inv({ id: "d", amount: 9999, paid: 0, dueOn: new Date(2026, 1, 1), void: true }),
    ];
    const s = computeRevenueSummary(invoices, [], [], NOW);
    expect(s.ytdScheduled).toBe(2500);
    expect(s.ytdCollected).toBe(2000);
    expect(s.collectionRate).toBe(80);
    expect(s.pastDueTotal).toBe(500);
    expect(s.overdue.map((o) => o.id)).toEqual(["c"]);
    expect(s.overdue[0].balance).toBe(500);
  });

  test("collection rate is 100 when nothing is scheduled yet", () => {
    const s = computeRevenueSummary([], [], [], NOW);
    expect(s.collectionRate).toBe(100);
    expect(s.ytdScheduled).toBe(0);
  });

  test("overdue is sorted oldest-first", () => {
    const invoices = [
      inv({ id: "new", amount: 100, dueOn: new Date(2026, 5, 1) }),
      inv({ id: "old", amount: 100, dueOn: new Date(2026, 0, 1) }),
    ];
    const s = computeRevenueSummary(invoices, [], [], NOW);
    expect(s.overdue.map((o) => o.id)).toEqual(["old", "new"]);
  });
});

describe("computeRevenueSummary — this/next month + target", () => {
  test("buckets dues into this month, next month, and the full-year target", () => {
    const invoices = [
      inv({ id: "tm", amount: 300, paid: 100, dueOn: new Date(2026, 6, 20) }), // Jul
      inv({ id: "nm", amount: 400, dueOn: new Date(2026, 7, 5) }), // Aug
      inv({ id: "ny", amount: 999, dueOn: new Date(2027, 0, 5) }), // next year
    ];
    const s = computeRevenueSummary(invoices, [], [], NOW);
    expect(s.dueThisMonthTotal).toBe(300);
    expect(s.dueThisMonthReceived).toBe(100);
    expect(s.dueNextMonthTotal).toBe(400);
    // Full-year target counts only this calendar year's dues.
    expect(s.fullYearTarget).toBe(700);
  });
});

describe("computeRevenueSummary — ARR + tiers + member bars", () => {
  const companies: RevenueCompany[] = [
    { name: "Big", status: "member", tier: "Director Level", annualValue: 50000 },
    { name: "Mid", status: "member", tier: "Advisory Level", annualValue: 20000 },
    { name: "Part", status: "strategic_partner", tier: null, annualValue: 10000 },
    { name: "Lead", status: "prospect", tier: null, annualValue: 99999 }, // excluded
    { name: "Gone", status: "former", tier: null, annualValue: 99999 }, // excluded
  ];

  test("ARR sums only in-network companies", () => {
    const s = computeRevenueSummary([], companies, [], NOW);
    expect(s.totalArr).toBe(80000);
  });

  test("tier breakdown groups by tier (null → Untiered) and sorts by ARR", () => {
    const s = computeRevenueSummary([], companies, [], NOW);
    expect(s.tierBreakdown).toEqual([
      { tier: "Director Level", count: 1, arr: 50000 },
      { tier: "Advisory Level", count: 1, arr: 20000 },
      { tier: "Untiered", count: 1, arr: 10000 },
    ]);
  });

  test("members-by-revenue is sorted desc with pct of the top earner", () => {
    const s = computeRevenueSummary([], companies, [], NOW);
    expect(s.membersByRevenue.map((m) => m.name)).toEqual(["Big", "Mid", "Part"]);
    expect(s.membersByRevenue[0].pct).toBe(100);
    expect(s.membersByRevenue[1].pct).toBe(40);
  });
});

describe("computeRevenueSummary — months + quarters", () => {
  test("months and quarters bucket non-void dues chronologically with phase", () => {
    const invoices = [
      inv({ id: "q1", amount: 100, dueOn: new Date(2026, 1, 1) }), // Feb → Q1 past
      inv({ id: "q3a", amount: 200, dueOn: new Date(2026, 6, 1) }), // Jul → Q3 current
      inv({ id: "q3b", amount: 50, dueOn: new Date(2026, 8, 1) }), // Sep → Q3 current
      inv({ id: "q4", amount: 300, dueOn: new Date(2026, 10, 1) }), // Nov → Q4 projected
    ];
    const s = computeRevenueSummary(invoices, [], [], NOW);
    expect(s.months.map((m) => m.label)).toEqual([
      "Feb 2026",
      "Jul 2026",
      "Sep 2026",
      "Nov 2026",
    ]);
    expect(s.quarters).toEqual([
      { label: "Q1 2026", total: 100, invoiceCount: 1, phase: "past" },
      { label: "Q3 2026", total: 250, invoiceCount: 2, phase: "current" },
      { label: "Q4 2026", total: 300, invoiceCount: 1, phase: "projected" },
    ]);
  });
});

describe("computeRevenueSummary — proposal pipeline", () => {
  test("splits won ARR from open pipeline and flags stale open proposals", () => {
    const proposals: RevenueProposal[] = [
      { amount: 50000, status: "won", lastActivityAt: new Date(2026, 5, 1) },
      { amount: 20000, status: "sent", lastActivityAt: new Date(2026, 6, 14) }, // fresh
      { amount: 30000, status: "negotiating", lastActivityAt: new Date(2026, 5, 1) }, // stale
      { amount: 10000, status: "draft", lastActivityAt: null }, // never touched → stale
      { amount: 99999, status: "lost", lastActivityAt: new Date(2026, 0, 1) }, // ignored
    ];
    const s = computeRevenueSummary([], [], proposals, NOW);
    expect(s.proposals.total).toBe(5);
    expect(s.proposals.wonArr).toBe(50000);
    expect(s.proposals.pipelineValue).toBe(60000);
    expect(s.proposals.staleCount).toBe(2);
  });
});
