import { describe, it, expect } from "vitest";

import { readMemberTiers, normalizeMemberTiers } from "@/lib/member-tiers";

// Unit test for org-configurable member tiers. Pure logic, no DB — guards the
// normalization the settings editor and the company write boundary both rely on.

describe("readMemberTiers", () => {
  it("reads the configured tiers from settings", () => {
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

describe("normalizeMemberTiers", () => {
  it("applies the same rules to a raw list", () => {
    expect(
      normalizeMemberTiers(["  Chairman ", "chairman", "", "Advisory"]),
    ).toEqual(["Chairman", "Advisory"]);
  });
});
