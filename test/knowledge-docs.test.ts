import { describe, expect, test } from "vitest";

import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_KIND_LABELS,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  cleanTitle,
  isKnowledgeKind,
  normalizeExtractedText,
} from "@/lib/knowledge-docs";

// Pure vocabulary + text-hygiene unit tests for the collateral store. These lock
// the shared helpers the upload action and extractor rely on, with no DB/AI.

describe("isKnowledgeKind", () => {
  test("accepts every known kind", () => {
    for (const kind of KNOWLEDGE_KINDS) expect(isKnowledgeKind(kind)).toBe(true);
  });

  test("rejects unknown values and non-strings", () => {
    expect(isKnowledgeKind("brochure")).toBe(false);
    expect(isKnowledgeKind("")).toBe(false);
    expect(isKnowledgeKind(undefined)).toBe(false);
    expect(isKnowledgeKind(42)).toBe(false);
  });

  test("every kind has a label", () => {
    for (const kind of KNOWLEDGE_KINDS)
      expect(KNOWLEDGE_KIND_LABELS[kind]).toBeTruthy();
  });
});

describe("cleanTitle", () => {
  test("trims and collapses internal whitespace", () => {
    expect(cleanTitle("  2026   Chairman's   deck  ")).toBe(
      "2026 Chairman's deck",
    );
  });

  test("caps to MAX_TITLE_LENGTH", () => {
    const long = "a".repeat(MAX_TITLE_LENGTH + 50);
    expect(cleanTitle(long).length).toBe(MAX_TITLE_LENGTH);
  });

  test("empty stays empty", () => {
    expect(cleanTitle("   ")).toBe("");
  });
});

describe("normalizeExtractedText", () => {
  test("normalizes CRLF/CR line endings to LF", () => {
    expect(normalizeExtractedText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  test("strips trailing spaces before newlines", () => {
    expect(normalizeExtractedText("a   \nb\t\nc")).toBe("a\nb\nc");
  });

  test("collapses 3+ blank lines to one but keeps paragraph breaks", () => {
    expect(normalizeExtractedText("a\n\n\n\nb\n\nc")).toBe("a\n\nb\n\nc");
  });

  test("trims the ends", () => {
    expect(normalizeExtractedText("\n\n  hello  \n\n")).toBe("hello");
  });

  test("caps to MAX_TEXT_LENGTH", () => {
    const long = "x".repeat(MAX_TEXT_LENGTH + 100);
    expect(normalizeExtractedText(long).length).toBe(MAX_TEXT_LENGTH);
  });
});
