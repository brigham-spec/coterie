import { describe, it, expect } from "vitest";

import { numFromJson, recordFromJson, strFromJson } from "@/lib/json-coerce";

// Unit test for the shared defensive Json coercers (used by value-created and
// hv-services). Untyped Postgres Json may arrive missing, malformed, or as strings.

describe("numFromJson", () => {
  it("passes finite numbers and numeric strings through", () => {
    expect(numFromJson(42)).toBe(42);
    expect(numFromJson("1500")).toBe(1500);
    expect(numFromJson("3.5")).toBe(3.5);
  });

  it("reads anything unusable as 0", () => {
    expect(numFromJson(NaN)).toBe(0);
    expect(numFromJson(Infinity)).toBe(0);
    expect(numFromJson("abc")).toBe(0);
    expect(numFromJson(null)).toBe(0);
    expect(numFromJson(undefined)).toBe(0);
    expect(numFromJson({})).toBe(0);
  });
});

describe("strFromJson", () => {
  it("trims strings and drops non-strings to empty", () => {
    expect(strFromJson("  hi  ")).toBe("hi");
    expect(strFromJson(5)).toBe("");
    expect(strFromJson(null)).toBe("");
  });
});

describe("recordFromJson", () => {
  it("passes plain objects and rejects arrays / primitives", () => {
    expect(recordFromJson({ a: 1 })).toEqual({ a: 1 });
    expect(recordFromJson([1, 2])).toEqual({});
    expect(recordFromJson("x")).toEqual({});
    expect(recordFromJson(null)).toEqual({});
  });
});
