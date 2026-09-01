import { describe, expect, test } from "vitest";

import {
  PROJECT_TYPES,
  parseProjectTypes,
  serializeProjectTypes,
} from "@/lib/project-types";

// Pure-unit coverage for the multi-select project-type helpers. parseProjectTypes
// splits a stored comma-joined string back into values (for pre-checking the edit
// form); serializeProjectTypes is the write boundary — it keeps only known
// vocabulary, dedupes in vocabulary order, and joins with ", ".

describe("parseProjectTypes", () => {
  test("splits, trims, and drops empties", () => {
    expect(parseProjectTypes("New Construction, Modular / Prefab")).toEqual([
      "New Construction",
      "Modular / Prefab",
    ]);
    expect(parseProjectTypes("  New Construction ,, ")).toEqual(["New Construction"]);
  });

  test("dedupes case-insensitively, keeping the first and preserving order", () => {
    expect(
      parseProjectTypes("Adaptive Reuse, adaptive reuse, Warehouse / Distribution"),
    ).toEqual(["Adaptive Reuse", "Warehouse / Distribution"]);
  });

  test("preserves legacy free-text values that predate the vocabulary", () => {
    expect(parseProjectTypes("Mixed-use redevelopment")).toEqual([
      "Mixed-use redevelopment",
    ]);
  });

  test("returns [] for null / empty", () => {
    expect(parseProjectTypes(null)).toEqual([]);
    expect(parseProjectTypes("")).toEqual([]);
    expect(parseProjectTypes("   ")).toEqual([]);
  });
});

describe("serializeProjectTypes", () => {
  test("keeps only the known vocabulary, in vocabulary order", () => {
    // Given out of order, returned in PROJECT_TYPES order.
    expect(
      serializeProjectTypes(["Modular / Prefab", "New Construction"]),
    ).toBe("New Construction, Modular / Prefab");
  });

  test("drops values outside the vocabulary (tampered payload) and dupes", () => {
    expect(
      serializeProjectTypes(["New Construction", "Bogus", "New Construction"]),
    ).toBe("New Construction");
  });

  test("returns '' when nothing valid is selected", () => {
    expect(serializeProjectTypes([])).toBe("");
    expect(serializeProjectTypes(["Bogus"])).toBe("");
  });

  test("round-trips every vocabulary value", () => {
    const all = serializeProjectTypes([...PROJECT_TYPES]);
    expect(parseProjectTypes(all)).toEqual([...PROJECT_TYPES]);
  });
});
