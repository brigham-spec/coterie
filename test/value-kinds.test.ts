import { describe, expect, test } from "vitest";

import { VALUE_KINDS, isValueKind } from "@/lib/value-kinds";

// The value-delivered vocabulary is the single source shared by the kind select
// and the action write-boundary. Guard the exact tokens and the membership check.

describe("value kinds", () => {
  test("exposes the kind vocabulary in order", () => {
    expect(VALUE_KINDS).toEqual([
      "introduction",
      "service",
      "grant",
      "event",
      "other",
    ]);
  });

  test("accepts known kinds and rejects everything else", () => {
    for (const k of VALUE_KINDS) expect(isValueKind(k)).toBe(true);
    expect(isValueKind("meeting")).toBe(false);
    expect(isValueKind("")).toBe(false);
    expect(isValueKind("Introduction")).toBe(false);
  });
});
