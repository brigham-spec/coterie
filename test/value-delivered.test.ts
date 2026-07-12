import { describe, expect, test } from "vitest";

import {
  buildValueReport,
  summarizeValueDelivered,
  type ValueDeliveredEntry,
} from "@/lib/value-delivered";

// Pure per-company rollup math for the Value Delivered card. Nullable amounts
// count toward the entry tally but contribute 0 dollars; the per-kind breakdown
// is deterministically ordered so the visual bars are stable.

function entry(over: Partial<ValueDeliveredEntry>): ValueDeliveredEntry {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "other",
    amount: null,
    summary: "",
    outcome: "",
    occurredAt: new Date("2026-01-01"),
    introLabel: null,
    ...over,
  };
}

describe("summarizeValueDelivered", () => {
  test("empty ledger is all zeros", () => {
    const s = summarizeValueDelivered([]);
    expect(s).toEqual({
      totalAmount: 0,
      entryCount: 0,
      monetaryCount: 0,
      byKind: [],
    });
  });

  test("sums amounts, counts entries, and splits monetary vs non-monetary", () => {
    const s = summarizeValueDelivered([
      entry({ kind: "introduction", amount: 50000 }),
      entry({ kind: "grant", amount: 25000 }),
      entry({ kind: "introduction", amount: null }), // non-monetary win
    ]);
    expect(s.totalAmount).toBe(75000);
    expect(s.entryCount).toBe(3);
    expect(s.monetaryCount).toBe(2);
  });

  test("per-kind breakdown aggregates and orders by dollars desc", () => {
    const s = summarizeValueDelivered([
      entry({ kind: "introduction", amount: 10000 }),
      entry({ kind: "introduction", amount: 40000 }),
      entry({ kind: "grant", amount: 25000 }),
    ]);
    expect(s.byKind).toEqual([
      { kind: "introduction", count: 2, amount: 50000 },
      { kind: "grant", count: 1, amount: 25000 },
    ]);
  });

  test("falls back to count-desc ordering when no amounts are set", () => {
    const s = summarizeValueDelivered([
      entry({ kind: "event" }),
      entry({ kind: "introduction" }),
      entry({ kind: "introduction" }),
    ]);
    expect(s.totalAmount).toBe(0);
    expect(s.byKind).toEqual([
      { kind: "introduction", count: 2, amount: 0 },
      { kind: "event", count: 1, amount: 0 },
    ]);
  });
});

describe("buildValueReport", () => {
  test("empty ledger has no period and no sections", () => {
    const r = buildValueReport([]);
    expect(r.summary.entryCount).toBe(0);
    expect(r.firstAt).toBeNull();
    expect(r.lastAt).toBeNull();
    expect(r.sections).toEqual([]);
  });

  test("groups entries by kind in the summary's richest-first order", () => {
    const r = buildValueReport([
      entry({ kind: "grant", amount: 25000 }),
      entry({ kind: "introduction", amount: 40000 }),
      entry({ kind: "introduction", amount: 10000 }),
    ]);
    // introduction (50k) outranks grant (25k).
    expect(r.sections.map((s) => s.kind)).toEqual(["introduction", "grant"]);
    expect(r.sections[0]).toMatchObject({ kind: "introduction", count: 2, amount: 50000 });
    expect(r.sections[1]).toMatchObject({ kind: "grant", count: 1, amount: 25000 });
  });

  test("derives the period from the oldest and newest entry", () => {
    const r = buildValueReport([
      entry({ occurredAt: new Date("2026-03-15") }),
      entry({ occurredAt: new Date("2026-01-02") }),
      entry({ occurredAt: new Date("2026-06-30") }),
    ]);
    expect(r.firstAt).toEqual(new Date("2026-01-02"));
    expect(r.lastAt).toEqual(new Date("2026-06-30"));
  });

  test("orders each section's entries newest first", () => {
    const older = entry({ kind: "service", occurredAt: new Date("2026-01-01") });
    const newer = entry({ kind: "service", occurredAt: new Date("2026-05-01") });
    const r = buildValueReport([older, newer]);
    expect(r.sections[0].entries.map((e) => e.id)).toEqual([newer.id, older.id]);
  });
});
