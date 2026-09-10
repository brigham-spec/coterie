import { describe, expect, it } from "vitest";

import {
  parseCompanySort,
  staleTone,
  tallyIntrosByCompany,
  tallyOpenActionsByCompany,
} from "@/lib/company-list";

// Unit tests for the PURE companies list-view derivations (slice S11a): the
// last-contact staleness bucket and the per-company open-action / intro tallies.

const NOW = new Date("2026-08-05T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

describe("staleTone", () => {
  it("returns none when there is no recorded contact", () => {
    expect(staleTone(null, NOW)).toBe("none");
  });

  it("is fresh through 60 days", () => {
    expect(staleTone(daysAgo(0), NOW)).toBe("fresh");
    expect(staleTone(daysAgo(60), NOW)).toBe("fresh");
  });

  it("is warm past 60 days through 90", () => {
    expect(staleTone(daysAgo(61), NOW)).toBe("warm");
    expect(staleTone(daysAgo(90), NOW)).toBe("warm");
  });

  it("is stale past 90 days", () => {
    expect(staleTone(daysAgo(91), NOW)).toBe("stale");
    expect(staleTone(daysAgo(400), NOW)).toBe("stale");
  });
});

describe("tallyOpenActionsByCompany", () => {
  it("attributes a manual commitment by companyId", () => {
    const counts = tallyOpenActionsByCompany([
      { companyId: "c1", ownerContact: null },
      { companyId: "c1", ownerContact: null },
      { companyId: "c2", ownerContact: null },
    ]);
    expect(counts.get("c1")).toBe(2);
    expect(counts.get("c2")).toBe(1);
  });

  it("attributes a they-owe item through the owing contact's company", () => {
    const counts = tallyOpenActionsByCompany([
      { companyId: null, ownerContact: { companyId: "c3" } },
    ]);
    expect(counts.get("c3")).toBe(1);
  });

  it("prefers companyId over the contact's company when both are present", () => {
    const counts = tallyOpenActionsByCompany([
      { companyId: "c1", ownerContact: { companyId: "c3" } },
    ]);
    expect(counts.get("c1")).toBe(1);
    expect(counts.has("c3")).toBe(false);
  });

  it("skips a row that attributes to no company", () => {
    const counts = tallyOpenActionsByCompany([
      { companyId: null, ownerContact: null },
    ]);
    expect(counts.size).toBe(0);
  });
});

describe("parseCompanySort", () => {
  it("defaults to name ascending when nothing is set", () => {
    expect(parseCompanySort("", "")).toEqual({ field: "name", dir: "asc" });
  });

  it("falls back to an unknown field's default direction", () => {
    expect(parseCompanySort("bogus", "")).toEqual({ field: "name", dir: "asc" });
  });

  it("uses each field's natural default direction", () => {
    expect(parseCompanySort("value", "")).toEqual({ field: "value", dir: "desc" });
    expect(parseCompanySort("added", "")).toEqual({ field: "added", dir: "desc" });
    expect(parseCompanySort("owner", "")).toEqual({ field: "owner", dir: "asc" });
  });

  it("honours an explicit direction", () => {
    expect(parseCompanySort("added", "asc")).toEqual({ field: "added", dir: "asc" });
    expect(parseCompanySort("name", "desc")).toEqual({ field: "name", dir: "desc" });
  });

  it("ignores an invalid direction", () => {
    expect(parseCompanySort("value", "sideways")).toEqual({
      field: "value",
      dir: "desc",
    });
  });

  it("maps the legacy newest/oldest sorts onto added", () => {
    expect(parseCompanySort("newest", "")).toEqual({ field: "added", dir: "desc" });
    expect(parseCompanySort("oldest", "")).toEqual({ field: "added", dir: "asc" });
  });
});

describe("tallyIntrosByCompany", () => {
  it("credits both parties' companies once each", () => {
    const counts = tallyIntrosByCompany([
      { partyA: { companyId: "a" }, partyB: { companyId: "b" } },
      { partyA: { companyId: "a" }, partyB: { companyId: "c" } },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBe(1);
  });

  it("credits a company once when both parties share it", () => {
    const counts = tallyIntrosByCompany([
      { partyA: { companyId: "a" }, partyB: { companyId: "a" } },
    ]);
    expect(counts.get("a")).toBe(1);
  });
});
