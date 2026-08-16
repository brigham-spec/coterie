import { describe, expect, it } from "vitest";

import {
  buildGroundingContext,
  MAX_DOC_CHARS,
  MAX_GROUNDING_CHARS,
  type GroundingDoc,
} from "@/lib/knowledge-grounding";

// Unit test for the PURE grounding-context builder (knowledge layer, Step 2).
// buildGroundingContext folds the org's own collateral into a labelled block the
// proposal generator reads: each doc labelled by its kind, per-doc + total caps
// enforced, blank docs skipped, empty input → "". No DB, no Anthropic.

const doc = (over: Partial<GroundingDoc> = {}): GroundingDoc => ({
  kind: "deck",
  title: "Pitch",
  content: "We connect founders to capital.",
  ...over,
});

describe("buildGroundingContext", () => {
  it("returns empty string with no docs", () => {
    expect(buildGroundingContext([])).toBe("");
  });

  it("labels each doc by its kind and title", () => {
    const out = buildGroundingContext([
      doc({ kind: "deck", title: "Overview", content: "body one" }),
      doc({ kind: "value_prop", title: "Why us", content: "body two" }),
    ]);
    expect(out).toContain("[Pitch deck] Overview");
    expect(out).toContain("body one");
    expect(out).toContain("[Value proposition] Why us");
    expect(out).toContain("body two");
    // Blocks are separated by a blank line.
    expect(out).toContain("\n\n");
  });

  it("falls back to the raw kind for unknown kinds", () => {
    const out = buildGroundingContext([doc({ kind: "brochure", content: "x" })]);
    expect(out).toContain("[brochure] Pitch");
  });

  it("skips docs whose content is blank", () => {
    const out = buildGroundingContext([
      doc({ title: "Empty", content: "   " }),
      doc({ title: "Kept", content: "real body" }),
    ]);
    expect(out).not.toContain("Empty");
    expect(out).toContain("Kept");
  });

  it("caps each doc to MAX_DOC_CHARS", () => {
    const big = "a".repeat(MAX_DOC_CHARS + 5_000);
    const out = buildGroundingContext([doc({ title: "Big", content: big })]);
    const aCount = (out.match(/a/g) ?? []).length;
    expect(aCount).toBe(MAX_DOC_CHARS);
  });

  it("stops adding docs once the total cap would be exceeded", () => {
    const chunk = "b".repeat(MAX_DOC_CHARS);
    // Each block is ~MAX_DOC_CHARS; more than MAX_GROUNDING_CHARS/MAX_DOC_CHARS of
    // them must not all fit.
    const many: GroundingDoc[] = Array.from({ length: 6 }, (_, i) =>
      doc({ title: `Doc${i}`, content: chunk }),
    );
    const out = buildGroundingContext(many);
    expect(out.length).toBeLessThanOrEqual(MAX_GROUNDING_CHARS + 200);
    // At least the first doc is present.
    expect(out).toContain("Doc0");
    // The last doc could not fit under the total cap.
    expect(out).not.toContain("Doc5");
  });
});
