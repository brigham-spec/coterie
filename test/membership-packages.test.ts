import { describe, it, expect } from "vitest";

import {
  MAX_NAME_LENGTH,
  MAX_SERVICE_LENGTH,
  normalizeMembershipPackages,
  readMembershipPackages,
} from "@/lib/membership-packages";

// Unit test for org-configurable membership packages. Pure logic, no DB — guards
// the normalization the settings editor and the settings write boundary both
// rely on: blank-name drop, price coercion, service-bullet cleaning, de-dupe,
// and the caps.

describe("readMembershipPackages", () => {
  it("reads well-formed packages from settings", () => {
    expect(
      readMembershipPackages({
        membershipPackages: [
          {
            name: "Chairman's Circle",
            annualPrice: 25000,
            summary: "Top-tier partnership",
            includedServices: ["Board access", "Quarterly briefings"],
          },
        ],
      }),
    ).toEqual([
      {
        name: "Chairman's Circle",
        annualPrice: 25000,
        summary: "Top-tier partnership",
        includedServices: ["Board access", "Quarterly briefings"],
      },
    ]);
  });

  it("returns [] when packages are absent or malformed", () => {
    expect(readMembershipPackages({})).toEqual([]);
    expect(readMembershipPackages(null)).toEqual([]);
    expect(readMembershipPackages(undefined)).toEqual([]);
    expect(readMembershipPackages("nope")).toEqual([]);
    expect(readMembershipPackages({ membershipPackages: "x" })).toEqual([]);
  });

  it("drops packages with a blank or missing name", () => {
    expect(
      readMembershipPackages({
        membershipPackages: [
          { name: "  ", annualPrice: 1 },
          { annualPrice: 1 },
          { name: "Advisory", annualPrice: 5000 },
        ],
      }),
    ).toEqual([
      { name: "Advisory", annualPrice: 5000, summary: "", includedServices: [] },
    ]);
  });

  it("coerces bad prices to null (custom) and defaults summary to ''", () => {
    expect(
      readMembershipPackages({
        membershipPackages: [
          { name: "A", annualPrice: -5 },
          { name: "B", annualPrice: "nope" },
          { name: "C" },
        ],
      }),
    ).toEqual([
      { name: "A", annualPrice: null, summary: "", includedServices: [] },
      { name: "B", annualPrice: null, summary: "", includedServices: [] },
      { name: "C", annualPrice: null, summary: "", includedServices: [] },
    ]);
  });

  it("trims service bullets, drops blanks, and skips non-strings", () => {
    expect(
      readMembershipPackages({
        membershipPackages: [
          {
            name: "A",
            includedServices: ["  Access  ", "", "   ", 5, null, "Events"],
          },
        ],
      })[0].includedServices,
    ).toEqual(["Access", "Events"]);
  });

  it("de-dupes by name case-insensitively, first spelling wins", () => {
    expect(
      readMembershipPackages({
        membershipPackages: [
          { name: "Director" },
          { name: "director", annualPrice: 5 },
          { name: "DIRECTOR" },
        ],
      }),
    ).toEqual([
      { name: "Director", annualPrice: null, summary: "", includedServices: [] },
    ]);
  });

  it("caps name length, list size, and service count/length", () => {
    const long = "x".repeat(200);
    const pkg = readMembershipPackages({
      membershipPackages: [
        {
          name: long,
          includedServices: [
            long,
            ...Array.from({ length: 30 }, (_, i) => `svc ${i}`),
          ],
        },
      ],
    })[0];
    expect(pkg.name).toHaveLength(MAX_NAME_LENGTH);
    expect(pkg.includedServices[0]).toHaveLength(MAX_SERVICE_LENGTH);
    expect(pkg.includedServices).toHaveLength(20);

    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Tier ${i}` }));
    expect(readMembershipPackages({ membershipPackages: many })).toHaveLength(12);
  });
});

describe("normalizeMembershipPackages", () => {
  it("applies the same rules to a raw package list", () => {
    expect(
      normalizeMembershipPackages([
        {
          name: "  Chairman ",
          annualPrice: 25000,
          summary: "  positioning  ",
          includedServices: [" Access ", ""],
        },
        {
          name: "chairman",
          annualPrice: 5,
          summary: "",
          includedServices: [],
        },
        { name: "", annualPrice: 1, summary: "", includedServices: [] },
      ]),
    ).toEqual([
      {
        name: "Chairman",
        annualPrice: 25000,
        summary: "positioning",
        includedServices: ["Access"],
      },
    ]);
  });
});
