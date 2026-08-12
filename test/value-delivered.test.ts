import { describe, expect, test } from "vitest";

import {
  buildValueReport,
  deriveValueEntries,
  roiMultiplier,
  summarizeValueDelivered,
  type DerivedIntro,
  type DerivedEvent,
  type DerivedCollaboration,
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

function intro(over: Partial<DerivedIntro>): DerivedIntro {
  return {
    introId: Math.random().toString(36).slice(2),
    status: "made",
    headline: "",
    outcome: null,
    madeOn: new Date("2026-02-01"),
    createdAt: new Date("2026-01-15"),
    partyAName: "Alice",
    partyBName: "Bob",
    counterpartCompany: "Acme Capital",
    ...over,
  };
}

function evt(over: Partial<DerivedEvent>): DerivedEvent {
  return {
    inviteeId: Math.random().toString(36).slice(2),
    eventName: "Spring Roundtable",
    rsvp: "attended",
    occurredAt: new Date("2026-03-01"),
    ...over,
  };
}

function collab(over: Partial<DerivedCollaboration>): DerivedCollaboration {
  return {
    projectId: Math.random().toString(36).slice(2),
    projectName: "Riverside Mixed-Use",
    role: "equity_partner",
    occurredAt: new Date("2026-04-01"),
    ...over,
  };
}

describe("deriveValueEntries", () => {
  const empty = { intros: [], events: [], collaborations: [], ledgerIntroIds: new Set<string>() };

  test("no activity derives no entries", () => {
    expect(deriveValueEntries(empty)).toEqual([]);
  });

  test("realized intros derive non-monetary introduction entries", () => {
    const [e] = deriveValueEntries({
      ...empty,
      intros: [intro({ introId: "x1", headline: "Warm intro to Acme" })],
    });
    expect(e).toMatchObject({
      id: "derived-intro-x1",
      kind: "introduction",
      amount: null,
      summary: "Warm intro to Acme",
      introLabel: "Alice \u2194 Bob",
      occurredAt: new Date("2026-02-01"),
    });
  });

  test("intros below 'made' status are excluded", () => {
    const out = deriveValueEntries({
      ...empty,
      intros: [intro({ status: "suggested" }), intro({ status: "drafted" })],
    });
    expect(out).toEqual([]);
  });

  test("intros already in the manual ledger are suppressed (no double count)", () => {
    const out = deriveValueEntries({
      ...empty,
      intros: [intro({ introId: "dup" })],
      ledgerIntroIds: new Set(["dup"]),
    });
    expect(out).toEqual([]);
  });

  test("falls back to counterpart company when the intro has no headline", () => {
    const [e] = deriveValueEntries({
      ...empty,
      intros: [intro({ headline: "", counterpartCompany: "Acme Capital" })],
    });
    expect(e.summary).toBe("Introduced to Acme Capital");
  });

  test("intro with no made date falls back to createdAt", () => {
    const [e] = deriveValueEntries({
      ...empty,
      intros: [intro({ madeOn: null, createdAt: new Date("2026-01-10") })],
    });
    expect(e.occurredAt).toEqual(new Date("2026-01-10"));
  });

  test("attended and confirmed events derive event entries; others are excluded", () => {
    const out = deriveValueEntries({
      ...empty,
      events: [
        evt({ inviteeId: "a", rsvp: "attended", eventName: "Gala" }),
        evt({ inviteeId: "c", rsvp: "confirmed", eventName: "Panel" }),
        evt({ inviteeId: "d", rsvp: "invited" }),
        evt({ inviteeId: "e", rsvp: "no_show" }),
      ],
    });
    expect(out.map((e) => e.summary)).toEqual(["Attended Gala", "Confirmed for Panel"]);
    expect(out.every((e) => e.kind === "event" && e.amount === null)).toBe(true);
  });

  test("project links derive non-monetary collaboration entries under 'other'", () => {
    const [e] = deriveValueEntries({
      ...empty,
      collaborations: [collab({ projectId: "p1", projectName: "Riverside", role: "equity_partner" })],
    });
    expect(e).toMatchObject({
      id: "derived-collab-p1",
      kind: "other",
      amount: null,
      summary: "Collaborating on Riverside",
      outcome: "Role: equity partner",
    });
  });
});

describe("roiMultiplier", () => {
  test("divides realized value by annual dues", () => {
    expect(roiMultiplier(150000, 50000)).toBe(3);
  });

  test("is null when there is no realized dollar value", () => {
    expect(roiMultiplier(0, 50000)).toBeNull();
  });

  test("is null when there are no dues", () => {
    expect(roiMultiplier(150000, 0)).toBeNull();
  });
});
