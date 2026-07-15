import { describe, expect, test } from "vitest";

import {
  FUNDING_CATEGORIES,
  FUNDING_STATUSES,
  isFundingCategory,
  isFundingStatus,
} from "@/lib/funding";
import {
  DEFAULT_REGIONAL_PROGRAMS,
  getRegionalProgramsForCounty,
} from "@/lib/regional-programs";

// Unit tests for the funding vocabulary and the regional-program county matcher.

describe("funding vocabulary", () => {
  test("accepts every canonical category and status", () => {
    for (const c of FUNDING_CATEGORIES) expect(isFundingCategory(c)).toBe(true);
    for (const s of FUNDING_STATUSES) expect(isFundingStatus(s)).toBe(true);
  });

  test("rejects out-of-vocabulary or mis-cased values", () => {
    expect(isFundingCategory("grant")).toBe(false);
    expect(isFundingCategory("Subsidy")).toBe(false);
    expect(isFundingStatus("identified")).toBe(false);
    expect(isFundingStatus("Won")).toBe(false);
  });
});

describe("getRegionalProgramsForCounty", () => {
  test("returns nothing for a blank county", () => {
    expect(getRegionalProgramsForCounty(null)).toEqual([]);
    expect(getRegionalProgramsForCounty("")).toEqual([]);
    expect(getRegionalProgramsForCounty("   ")).toEqual([]);
  });

  test("matches a county plus the region-wide programs, case-insensitively", () => {
    const ulster = getRegionalProgramsForCounty("Ulster");
    const names = ulster.map((p) => p.name);
    // County-specific
    expect(names).toContain("Ulster County Housing Action Fund (HAF)");
    // Region-wide (mid-hudson) always included
    expect(names).toContain("Restore NY Communities Initiative");
    // Not an Orange-only program
    expect(names).not.toContain("Orange County IDA (OCIDA)");
  });

  test("a county with no dedicated program still gets the region-wide set", () => {
    const rockland = getRegionalProgramsForCounty("Rockland");
    // Every returned program is region-wide, never a county-specific one.
    const regionWide = DEFAULT_REGIONAL_PROGRAMS.filter((p) => {
      const j = p.jurisdiction.toLowerCase();
      return j.includes("mid-hudson") || j.includes("region");
    }).map((p) => p.name);
    expect(rockland.map((p) => p.name).sort()).toEqual(regionWide.sort());
  });
});
