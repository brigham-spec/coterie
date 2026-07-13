import { describe, expect, test } from "vitest";

import { extractJsonArray, extractJsonObject } from "@/lib/json-extract";

// The extractors must return the FIRST balanced top-level structure and ignore
// any trailing prose — including trailing text that itself contains braces or
// brackets, the case a naive first-open/last-close slice mangles into invalid
// JSON and drops.

describe("extractJsonObject", () => {
  test("pulls a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  test("ignores trailing prose that contains braces", () => {
    const raw = 'Here you go: {"a":1}. Let me know if you need anything {else}!';
    expect(extractJsonObject(raw)).toBe('{"a":1}');
  });

  test("does not count braces inside string values", () => {
    const raw = '{"note":"a } b { c","n":2}';
    expect(extractJsonObject(raw)).toBe('{"note":"a } b { c","n":2}');
  });

  test("respects escaped quotes inside strings", () => {
    const raw = '{"q":"she said \\"hi\\" }","n":3} trailing';
    expect(extractJsonObject(raw)).toBe('{"q":"she said \\"hi\\" }","n":3}');
  });

  test("handles nested objects", () => {
    const raw = 'prefix {"a":{"b":2}} suffix';
    expect(extractJsonObject(raw)).toBe('{"a":{"b":2}}');
  });

  test("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });

  test("returns null when the object never closes", () => {
    expect(extractJsonObject('{"a":1')).toBeNull();
  });
});

describe("extractJsonArray", () => {
  test("pulls the first balanced array and ignores trailing prose", () => {
    const raw = '```json\n[{"id":"a"}]\n```\nDone [see above]';
    expect(extractJsonArray(raw)).toBe('[{"id":"a"}]');
  });

  test("does not count brackets inside string values", () => {
    const raw = '[{"t":"a ] b"}] tail';
    expect(extractJsonArray(raw)).toBe('[{"t":"a ] b"}]');
  });

  test("returns null when the array never closes", () => {
    expect(extractJsonArray("[1, 2, 3")).toBeNull();
  });
});
