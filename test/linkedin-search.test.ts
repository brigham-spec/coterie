import { describe, expect, test } from "vitest";

import {
  searchLinkedinContacts,
  tokenizeQuery,
  type LinkedinSearchRow,
} from "@/lib/linkedin-search";

// Pure unit tests for the deterministic recall search (step 3). The scorer must
// (a) drop question scaffolding but keep content words, (b) match stated +
// inferred fields with weighted scoring, (c) report EXACTLY which fields matched
// for provenance, and (d) rank deterministically (score, then breadth, then name).

function row(overrides: Partial<LinkedinSearchRow> = {}): LinkedinSearchRow {
  return {
    id: overrides.id ?? "id",
    fullName: overrides.fullName ?? "Jane Doe",
    company: overrides.company ?? "",
    title: overrides.title ?? "",
    profileUrl: overrides.profileUrl ?? null,
    industry: overrides.industry ?? null,
    industryConfidence: overrides.industryConfidence ?? null,
    seniority: overrides.seniority ?? null,
    seniorityConfidence: overrides.seniorityConfidence ?? null,
    jobFunction: overrides.jobFunction ?? null,
    jobFunctionConfidence: overrides.jobFunctionConfidence ?? null,
  };
}

describe("tokenizeQuery", () => {
  test("drops question scaffolding but keeps content words", () => {
    expect(tokenizeQuery("who do i know that works in finance")).toEqual([
      "works",
      "finance",
    ]);
  });

  test("lowercases, de-duplicates, and drops 1-char noise", () => {
    expect(tokenizeQuery("Finance FINANCE a b2b")).toEqual(["finance", "b2b"]);
  });

  test("returns empty for a scaffolding-only query", () => {
    expect(tokenizeQuery("who do i know")).toEqual([]);
  });
});

describe("searchLinkedinContacts", () => {
  test("returns nothing when the query has no content tokens", () => {
    const rows = [row({ industry: "Finance" })];
    expect(searchLinkedinContacts(rows, "who do i know")).toEqual([]);
  });

  test("matches an inferred dimension and reports it as the matched field", () => {
    const rows = [
      row({ id: "a", fullName: "Ada", industry: "Finance" }),
      row({ id: "b", fullName: "Ben", industry: "Software" }),
    ];
    const hits = searchLinkedinContacts(rows, "who works in finance");
    expect(hits).toHaveLength(1);
    expect(hits[0].row.id).toBe("a");
    expect(hits[0].matched).toEqual(["industry"]);
    expect(hits[0].score).toBe(3);
  });

  test("weights inferred dimensions above stated free-text fields", () => {
    // "finance" as an inferred industry (weight 3) should outrank "finance"
    // landing only in a company name (weight 2).
    const rows = [
      row({ id: "co", fullName: "Zed", company: "Finance Partners" }),
      row({ id: "ind", fullName: "Amy", industry: "Finance" }),
    ];
    const hits = searchLinkedinContacts(rows, "finance");
    expect(hits.map((h) => h.row.id)).toEqual(["ind", "co"]);
    expect(hits[0].score).toBe(3);
    expect(hits[1].score).toBe(2);
  });

  test("accumulates score across multiple matched fields", () => {
    const rows = [
      row({
        id: "multi",
        fullName: "Grace Hopper",
        title: "VP Engineering",
        industry: "Software",
        jobFunction: "Engineering",
      }),
    ];
    const hits = searchLinkedinContacts(rows, "engineering");
    expect(hits).toHaveLength(1);
    // jobFunction (3) + title (2) both hit "engineering".
    expect(hits[0].matched).toEqual(["jobFunction", "title"]);
    expect(hits[0].score).toBe(5);
  });

  test("plural tolerance finds a singular field value", () => {
    const rows = [row({ id: "d", fullName: "Dee", seniority: "Director" })];
    const hits = searchLinkedinContacts(rows, "directors");
    expect(hits).toHaveLength(1);
    expect(hits[0].matched).toEqual(["seniority"]);
  });

  test("breaks score ties by breadth of distinct tokens matched", () => {
    // Both hit the SAME single field (industry, weight 3) so scores tie at 3,
    // but "broad" matches two distinct query tokens where "narrow" matches one.
    const broad = row({ id: "broad", fullName: "Zed", industry: "Finance tech" });
    const narrow = row({ id: "narrow", fullName: "Amy", industry: "Finance" });
    const hits = searchLinkedinContacts([narrow, broad], "finance tech");
    expect(hits.map((h) => h.row.id)).toEqual(["broad", "narrow"]);
    expect(hits[0].score).toBe(3);
    expect(hits[1].score).toBe(3);
  });

  test("breaks score+breadth ties alphabetically by name", () => {
    const rows = [
      row({ id: "z", fullName: "Zoe", industry: "Finance" }),
      row({ id: "a", fullName: "Ada", industry: "Finance" }),
    ];
    const hits = searchLinkedinContacts(rows, "finance");
    expect(hits.map((h) => h.row.fullName)).toEqual(["Ada", "Zoe"]);
  });

  test("excludes non-matching rows and honors the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `r${i}`, fullName: `Person ${i}`, industry: "Finance" }),
    );
    rows.push(row({ id: "miss", industry: "Healthcare" }));
    const hits = searchLinkedinContacts(rows, "finance", 3);
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.row.id !== "miss")).toBe(true);
  });
});
