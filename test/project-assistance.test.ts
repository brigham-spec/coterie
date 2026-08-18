import { describe, expect, test } from "vitest";

import {
  ASSISTANCE_DEFS,
  getAssistanceDef,
  isAssistanceKey,
  parseAssistanceKeys,
} from "@/lib/project-assistance";

// Pure vocabulary + parser for what a project asks the org to help with.

describe("isAssistanceKey", () => {
  test("accepts vocabulary keys, rejects others", () => {
    expect(isAssistanceKey("equity_sourcing")).toBe(true);
    expect(isAssistanceKey("cfa_application")).toBe(true);
    expect(isAssistanceKey("not_a_key")).toBe(false);
    expect(isAssistanceKey("")).toBe(false);
  });
});

describe("getAssistanceDef", () => {
  test("resolves a known key to its definition", () => {
    expect(getAssistanceDef("ida_navigation").label).toBe("IDA / PILOT Navigation");
  });

  test("falls back to the raw key as label for unknown keys", () => {
    const def = getAssistanceDef("mystery");
    expect(def.label).toBe("mystery");
    expect(def.desc).toBe("");
  });
});

describe("parseAssistanceKeys", () => {
  test("keeps only in-vocabulary keys", () => {
    expect(parseAssistanceKeys(["equity_sourcing", "bogus", "grants"])).toEqual([
      "equity_sourcing",
      "grants",
    ]);
  });

  test("returns keys in ASSISTANCE_DEFS display order regardless of input order", () => {
    const reversed = [...ASSISTANCE_DEFS].map((d) => d.key).reverse();
    expect(parseAssistanceKeys(reversed)).toEqual(ASSISTANCE_DEFS.map((d) => d.key));
  });

  test("de-dupes repeated keys", () => {
    expect(parseAssistanceKeys(["grants", "grants", "grants"])).toEqual(["grants"]);
  });

  test("reads a missing / malformed value as empty", () => {
    expect(parseAssistanceKeys(null)).toEqual([]);
    expect(parseAssistanceKeys(undefined)).toEqual([]);
    expect(parseAssistanceKeys("equity_sourcing")).toEqual([]);
    expect(parseAssistanceKeys([1, 2, {}])).toEqual([]);
  });
});
