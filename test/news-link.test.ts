import { describe, expect, it } from "vitest";

import {
  isPublicHttpUrl,
  htmlToText,
  extractTitle,
  parseArticleSummary,
} from "@/lib/news-link";

// Pure-function unit tests for the pasted-link enrichment seam. The fetch + AI
// paths (fetchArticlePage, summarizeArticleLink) are network/model-bound and
// exercised through the news action suite's mock; here we lock down the pure
// guards and parsers that decide what gets fetched and how a page/completion is
// reduced to storable content.

describe("isPublicHttpUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://example.com/article")).toBe(true);
    expect(isPublicHttpUrl("http://news.example.org/story?id=1")).toBe(true);
    // A public IP in the 172.32+ range is NOT private (only 172.16-31 is).
    expect(isPublicHttpUrl("https://172.32.0.1/x")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isPublicHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isPublicHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpUrl("not a url")).toBe(false);
  });

  it("rejects loopback and internal hostnames", () => {
    expect(isPublicHttpUrl("http://localhost/x")).toBe(false);
    expect(isPublicHttpUrl("http://db.localhost/x")).toBe(false);
    expect(isPublicHttpUrl("http://api.internal/x")).toBe(false);
    expect(isPublicHttpUrl("http://printer.local/x")).toBe(false);
  });

  it("rejects private, loopback, and link-local IPv4 ranges", () => {
    expect(isPublicHttpUrl("http://127.0.0.1/x")).toBe(false);
    expect(isPublicHttpUrl("http://10.0.0.5/x")).toBe(false);
    expect(isPublicHttpUrl("http://192.168.1.1/x")).toBe(false);
    expect(isPublicHttpUrl("http://172.16.0.1/x")).toBe(false);
    expect(isPublicHttpUrl("http://172.31.255.255/x")).toBe(false);
    // The cloud metadata endpoint (link-local).
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(
      false,
    );
  });

  it("rejects IPv6 loopback and link-local", () => {
    expect(isPublicHttpUrl("http://[::1]/x")).toBe(false);
    expect(isPublicHttpUrl("http://[fe80::1]/x")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("strips script, style, and tags and decodes entities", () => {
    const html = `
      <html><head><title>T</title><style>.a{color:red}</style></head>
      <body>
        <script>var x = 1 < 2;</script>
        <h1>Hello &amp; welcome</h1>
        <p>A &quot;quoted&quot; line with&nbsp;a gap.</p>
      </body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Hello & welcome");
    expect(text).toContain('A "quoted" line with a gap.');
    expect(text).not.toContain("var x");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("<h1>");
  });

  it("collapses whitespace and bounds length", () => {
    const text = htmlToText("<p>a\n\n   b\t\tc</p>");
    expect(text).toBe("a b c");

    const long = htmlToText("<p>" + "x".repeat(20_000) + "</p>");
    expect(long.length).toBe(8_000);
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("<p>caf&#233;</p>")).toBe("café");
  });
});

describe("extractTitle", () => {
  it("prefers og:title over <title>", () => {
    const html = `<head><title>Site name</title>
      <meta property="og:title" content="The Real Headline" /></head>`;
    expect(extractTitle(html)).toBe("The Real Headline");
  });

  it("falls back to <title> and decodes entities", () => {
    expect(extractTitle("<head><title>News &amp; Notes</title></head>")).toBe(
      "News & Notes",
    );
  });

  it("returns empty string when neither is present", () => {
    expect(extractTitle("<body><p>no title here</p></body>")).toBe("");
  });
});

describe("parseArticleSummary", () => {
  it("parses a clean JSON object", () => {
    const out = parseArticleSummary(
      '{"headline":"H","summary":"S","keyFacts":["$5M","2026"]}',
    );
    expect(out).toEqual({ headline: "H", summary: "S", keyFacts: ["$5M", "2026"] });
  });

  it("tolerates fenced / prose-wrapped JSON", () => {
    const raw =
      'Here you go:\n```json\n{"headline":"H","summary":"S","keyFacts":[]}\n```';
    expect(parseArticleSummary(raw)).toEqual({
      headline: "H",
      summary: "S",
      keyFacts: [],
    });
  });

  it("collapses invalid / empty input to empty fields", () => {
    expect(parseArticleSummary("not json at all")).toEqual({
      headline: "",
      summary: "",
      keyFacts: [],
    });
    expect(parseArticleSummary('{"headline":"","summary":"","keyFacts":[]}')).toEqual(
      { headline: "", summary: "", keyFacts: [] },
    );
  });

  it("drops non-string facts, caps to 5, and bounds lengths", () => {
    const facts = ["a", "b", "c", "d", "e", "f", "g"];
    const out = parseArticleSummary(
      JSON.stringify({
        headline: "x".repeat(300),
        summary: "y".repeat(2000),
        keyFacts: [...facts, 42, null],
      }),
    );
    expect(out.headline.length).toBe(200);
    expect(out.summary.length).toBe(1000);
    expect(out.keyFacts).toEqual(["a", "b", "c", "d", "e"]);

    const longFact = parseArticleSummary(
      JSON.stringify({ headline: "h", summary: "s", keyFacts: ["z".repeat(300)] }),
    );
    expect(longFact.keyFacts[0].length).toBe(120);
  });
});
