import { describe, it, expect } from "vitest";

import {
  autoAssignTier,
  normalizeMemberTierDefs,
  readMemberTierDefs,
  readMemberTiers,
} from "@/lib/member-tiers";

// Unit test for org-configurable member tiers. Pure logic, no DB — guards the
// normalization the settings editor and the company write boundary both rely on,
// plus the sliding-threshold auto-assignment (S7).

describe("readMemberTiers", () => {
  it("reads the configured tier labels from settings", () => {
    expect(
      readMemberTiers({ memberTiers: ["Chairman", "Director", "Advisory"] }),
    ).toEqual(["Chairman", "Director", "Advisory"]);
  });

  it("returns [] when tiers are absent or malformed", () => {
    expect(readMemberTiers({})).toEqual([]);
    expect(readMemberTiers(null)).toEqual([]);
    expect(readMemberTiers(undefined)).toEqual([]);
    expect(readMemberTiers("nope")).toEqual([]);
    expect(readMemberTiers({ memberTiers: "Chairman" })).toEqual([]);
  });

  it("trims, drops blanks, and skips non-strings", () => {
    expect(
      readMemberTiers({ memberTiers: ["  Chairman  ", "", "   ", 5, null, "Advisory"] }),
    ).toEqual(["Chairman", "Advisory"]);
  });

  it("de-dupes case-insensitively, first spelling wins", () => {
    expect(
      readMemberTiers({ memberTiers: ["Director", "director", "DIRECTOR"] }),
    ).toEqual(["Director"]);
  });

  it("caps label length and list size", () => {
    const long = "x".repeat(100);
    expect(readMemberTiers({ memberTiers: [long] })[0]).toHaveLength(60);

    const many = Array.from({ length: 30 }, (_, i) => `Tier ${i}`);
    expect(readMemberTiers({ memberTiers: many })).toHaveLength(20);
  });
});

describe("readMemberTierDefs", () => {
  it("reads legacy string entries as unranked defs", () => {
    expect(readMemberTierDefs({ memberTiers: ["Director", "Advisory"] })).toEqual([
      { label: "Director", minValue: null },
      { label: "Advisory", minValue: null },
    ]);
  });

  it("reads {label, minValue} entries and coerces bad thresholds to null", () => {
    expect(
      readMemberTierDefs({
        memberTiers: [
          { label: "Director", minValue: 20000 },
          { label: "Advisory", minValue: 0 },
          { label: "Chairman", minValue: -5 },
          { label: "Partner", minValue: "nope" },
        ],
      }),
    ).toEqual([
      { label: "Director", minValue: 20000 },
      { label: "Advisory", minValue: 0 },
      { label: "Chairman", minValue: null },
      { label: "Partner", minValue: null },
    ]);
  });

  it("de-dupes by label case-insensitively across mixed shapes", () => {
    expect(
      readMemberTierDefs({
        memberTiers: ["Director", { label: "director", minValue: 5 }],
      }),
    ).toEqual([{ label: "Director", minValue: null }]);
  });
});

describe("normalizeMemberTierDefs", () => {
  it("applies the same rules to a raw def list", () => {
    expect(
      normalizeMemberTierDefs([
        { label: "  Director ", minValue: 20000 },
        { label: "director", minValue: 5 },
        { label: "", minValue: 1 },
        { label: "Advisory", minValue: null },
      ]),
    ).toEqual([
      { label: "Director", minValue: 20000 },
      { label: "Advisory", minValue: null },
    ]);
  });
});

describe("autoAssignTier", () => {
  const defs = [
    { label: "Director", minValue: 20000 },
    { label: "Advisory", minValue: 1 },
    { label: "Partner", minValue: null },
  ];

  it("picks the highest tier whose threshold the value clears", () => {
    expect(autoAssignTier(50000, defs)).toBe("Director");
    expect(autoAssignTier(20000, defs)).toBe("Director");
    expect(autoAssignTier(5000, defs)).toBe("Advisory");
    expect(autoAssignTier(1, defs)).toBe("Advisory");
  });

  it("returns null when no ranked tier qualifies", () => {
    expect(autoAssignTier(0, defs)).toBeNull();
    expect(autoAssignTier(100, [{ label: "Partner", minValue: null }])).toBeNull();
    expect(autoAssignTier(100, [])).toBeNull();
  });
});
