import { describe, expect, test } from "vitest";

import { parseNewsArticles } from "@/lib/news-scan";

// Pure-logic tests for the News Intelligence parser: web-search replies can be
// chatty and malformed, so parseNewsArticles must pull the first JSON array,
// coerce each entry, drop headline-less rows, sanitise URLs, and de-dupe by URL.

describe("parseNewsArticles", () => {
  test("parses a clean array and coerces every field", () => {
    const raw = JSON.stringify([
      {
        headline: "Acme breaks ground on Kingston mill",
        source: "HV Business Journal",
        date: "03/01/2026",
        url: "https://hvbj.example/acme-mill",
        summary: "Acme started construction.",
        significance: "First major project in the county.",
      },
    ]);
    expect(parseNewsArticles(raw)).toEqual([
      {
        headline: "Acme breaks ground on Kingston mill",
        source: "HV Business Journal",
        date: "03/01/2026",
        url: "https://hvbj.example/acme-mill",
        summary: "Acme started construction.",
        significance: "First major project in the county.",
      },
    ]);
  });

  test("extracts the array even when wrapped in prose / code fences", () => {
    const raw =
      'Here are the results:\n```json\n[{"headline":"Deal closed","url":"https://x.example/1"}]\n```\nHope that helps!';
    const out = parseNewsArticles(raw);
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe("Deal closed");
    expect(out[0].source).toBe("");
  });

  test("accepts `title` as a headline alias and trims whitespace", () => {
    const raw = JSON.stringify([{ title: "  Spaced out  ", url: "https://x.example/2" }]);
    expect(parseNewsArticles(raw)[0].headline).toBe("Spaced out");
  });

  test("drops entries with no headline", () => {
    const raw = JSON.stringify([
      { headline: "", url: "https://x.example/keep-nope" },
      { summary: "orphan summary" },
      { headline: "Real one", url: "https://x.example/real" },
    ]);
    expect(parseNewsArticles(raw).map((a) => a.headline)).toEqual(["Real one"]);
  });

  test("nulls out non-http(s) urls but keeps the article", () => {
    const raw = JSON.stringify([
      { headline: "No link", url: "not-a-url" },
      { headline: "Ftp link", url: "ftp://x.example/f" },
    ]);
    const out = parseNewsArticles(raw);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBeNull();
    expect(out[1].url).toBeNull();
  });

  test("de-dupes by URL (case-insensitive) but keeps url-less rows", () => {
    const raw = JSON.stringify([
      { headline: "First", url: "https://x.example/dup" },
      { headline: "Second (same url)", url: "https://X.EXAMPLE/dup" },
      { headline: "No url A" },
      { headline: "No url B" },
    ]);
    expect(parseNewsArticles(raw).map((a) => a.headline)).toEqual([
      "First",
      "No url A",
      "No url B",
    ]);
  });

  test("caps at 8 articles", () => {
    const raw = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({
        headline: `Story ${i}`,
        url: `https://x.example/${i}`,
      })),
    );
    expect(parseNewsArticles(raw)).toHaveLength(8);
  });

  test("returns [] for non-JSON, non-array, or empty responses", () => {
    expect(parseNewsArticles("no json here")).toEqual([]);
    expect(parseNewsArticles('{"headline":"object not array"}')).toEqual([]);
    expect(parseNewsArticles("[not valid json,]")).toEqual([]);
    expect(parseNewsArticles("")).toEqual([]);
  });
});
