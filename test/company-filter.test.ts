import { describe, expect, test } from "vitest";

import {
  companySegmentMatches,
  filterCompanies,
  type CompanyFilter,
} from "@/lib/company-list";

// Pure unit tests for the shared companies-list filter that both the page and the
// CSV export run, so the download can never drift from the view.

type Row = {
  name: string;
  status: string;
  industry: string;
  ownerUserId: string | null;
  networkTags: string[];
  tier: string | null;
  likelihood: number | null;
};

function company(overrides: Partial<Row> = {}): Row {
  return {
    name: "Acme",
    status: "member",
    industry: "",
    ownerUserId: null,
    networkTags: [],
    tier: null,
    likelihood: null,
    ...overrides,
  };
}

const NO_FILTER: CompanyFilter = {
  segment: "all",
  q: "",
  owner: "all",
  tag: "",
  tier: "",
  industry: "",
  likelihood: 0,
};

describe("companySegmentMatches", () => {
  test("All matches every status; a bucket matches only its status", () => {
    expect(companySegmentMatches("all", "prospect")).toBe(true);
    expect(companySegmentMatches("members", "member")).toBe(true);
    expect(companySegmentMatches("members", "prospect")).toBe(false);
    expect(companySegmentMatches("partners", "strategic_partner")).toBe(true);
    expect(companySegmentMatches("former", "former")).toBe(true);
  });

  test("an unknown segment key falls back to All", () => {
    expect(companySegmentMatches("bogus", "prospect")).toBe(true);
  });
});

describe("filterCompanies", () => {
  const rows = [
    company({ name: "Acme Build", status: "member", industry: "Construction Manager", ownerUserId: "u1", tier: "Gold", networkTags: ["ida_active"], likelihood: 4 }),
    company({ name: "Globex", status: "prospect", industry: "Software", ownerUserId: "u2", likelihood: 2 }),
    company({ name: "Initech", status: "former", industry: "Consulting", ownerUserId: null }),
  ];

  test("no filter returns everything", () => {
    expect(filterCompanies(rows, NO_FILTER)).toHaveLength(3);
  });

  test("segment narrows to a status bucket", () => {
    const out = filterCompanies(rows, { ...NO_FILTER, segment: "prospects" });
    expect(out.map((c) => c.name)).toEqual(["Globex"]);
  });

  test("q matches name or industry, case-insensitively", () => {
    expect(filterCompanies(rows, { ...NO_FILTER, q: "acme" }).map((c) => c.name)).toEqual(["Acme Build"]);
    expect(filterCompanies(rows, { ...NO_FILTER, q: "software" }).map((c) => c.name)).toEqual(["Globex"]);
  });

  test("owner filters to a user; all/'' mean everyone", () => {
    expect(filterCompanies(rows, { ...NO_FILTER, owner: "u2" }).map((c) => c.name)).toEqual(["Globex"]);
    expect(filterCompanies(rows, { ...NO_FILTER, owner: "" })).toHaveLength(3);
  });

  test("tag and tier narrow by membership", () => {
    expect(filterCompanies(rows, { ...NO_FILTER, tag: "ida_active" }).map((c) => c.name)).toEqual(["Acme Build"]);
    expect(filterCompanies(rows, { ...NO_FILTER, tier: "Gold" }).map((c) => c.name)).toEqual(["Acme Build"]);
  });

  test("industry filter matches on the rolled-up category", () => {
    // "Construction Manager" categorizes to "Construction".
    expect(filterCompanies(rows, { ...NO_FILTER, industry: "Construction" }).map((c) => c.name)).toEqual(["Acme Build"]);
  });

  test("likelihood is an inclusive floor", () => {
    expect(filterCompanies(rows, { ...NO_FILTER, likelihood: 4 }).map((c) => c.name)).toEqual(["Acme Build"]);
    expect(filterCompanies(rows, { ...NO_FILTER, likelihood: 2 }).map((c) => c.name)).toEqual(["Acme Build", "Globex"]);
  });
});
