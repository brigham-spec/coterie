import { describe, expect, it } from "vitest";

import {
  enabledModuleKeys,
  enabledNavHrefs,
  isModuleEnabled,
  MODULES,
  normalizeModuleSelection,
  OPTIONAL_MODULES,
} from "@/lib/modules";

// Unit tests for the PURE per-org module registry. Guards the packaging rule the
// nav filter + route guard both rest on: core modules are always on, optional
// modules follow the stored allowlist, and an ABSENT list means "all on" so an
// org predating the feature keeps its full surface. No DB.

describe("module registry", () => {
  it("has a nav href and a unique key for every module", () => {
    const keys = new Set(MODULES.map((m) => m.key));
    const hrefs = new Set(MODULES.map((m) => m.href));
    expect(keys.size).toBe(MODULES.length);
    expect(hrefs.size).toBe(MODULES.length);
    expect(MODULES.every((m) => m.href.startsWith("/dashboard"))).toBe(true);
  });

  it("keeps the five core modules always-on", () => {
    const core = MODULES.filter((m) => m.core).map((m) => m.key);
    expect(core).toEqual([
      "dashboard",
      "companies",
      "contacts",
      "introductions",
      "settings",
    ]);
  });
});

describe("enabledModuleKeys", () => {
  it("enables all optional modules when settings is unset (backward compatible)", () => {
    const enabled = enabledModuleKeys(null);
    expect(enabled.size).toBe(MODULES.length);
    for (const m of MODULES) expect(enabled.has(m.key)).toBe(true);
  });

  it("treats an absent modules key the same as no settings", () => {
    const enabled = enabledModuleKeys({ memberTiers: [] });
    expect(enabled.size).toBe(MODULES.length);
  });

  it("enables only the stored optional keys plus the always-on core", () => {
    const enabled = enabledModuleKeys({ modules: ["projects", "events"] });
    expect(enabled.has("projects")).toBe(true);
    expect(enabled.has("events")).toBe(true);
    expect(enabled.has("revenue")).toBe(false);
    expect(enabled.has("invoices")).toBe(false);
    // Core is always present regardless of the stored list.
    expect(enabled.has("dashboard")).toBe(true);
    expect(enabled.has("companies")).toBe(true);
    expect(enabled.has("settings")).toBe(true);
  });

  it("an empty stored list disables every optional module but keeps core", () => {
    const enabled = enabledModuleKeys({ modules: [] });
    expect([...enabled].sort()).toEqual(
      ["companies", "contacts", "dashboard", "introductions", "settings"].sort(),
    );
  });

  it("ignores unknown or non-string entries in the stored list", () => {
    const enabled = enabledModuleKeys({ modules: ["projects", "bogus", 7, null] });
    expect(enabled.has("projects")).toBe(true);
    expect(enabled.size).toBe(6); // 5 core + projects
  });
});

describe("isModuleEnabled", () => {
  it("returns true for a core module even if the stored list omits it", () => {
    expect(isModuleEnabled({ modules: [] }, "companies")).toBe(true);
  });

  it("returns false for an optional module absent from the stored list", () => {
    expect(isModuleEnabled({ modules: ["revenue"] }, "projects")).toBe(false);
    expect(isModuleEnabled({ modules: ["revenue"] }, "revenue")).toBe(true);
  });
});

describe("enabledNavHrefs", () => {
  it("returns hrefs in canonical MODULES order", () => {
    const hrefs = enabledNavHrefs({ modules: ["projects"] });
    // dashboard (core) comes before projects, which comes before the core tail.
    expect(hrefs).toContain("/dashboard/projects");
    expect(hrefs).not.toContain("/dashboard/revenue");
    expect(hrefs.indexOf("/dashboard")).toBeLessThan(hrefs.indexOf("/dashboard/projects"));
    expect(hrefs.indexOf("/dashboard/projects")).toBeLessThan(
      hrefs.indexOf("/dashboard/settings"),
    );
  });
});

describe("normalizeModuleSelection", () => {
  it("keeps only valid optional keys in canonical order, dropping core and junk", () => {
    const out = normalizeModuleSelection([
      "events",
      "dashboard", // core → dropped
      "revenue",
      "nonsense", // unknown → dropped
    ]);
    expect(out).toEqual(["revenue", "events"]); // canonical MODULES order
  });

  it("de-dupes repeated keys", () => {
    expect(normalizeModuleSelection(["news", "news"])).toEqual(["news"]);
  });

  it("returns every optional key when all are selected", () => {
    const all = OPTIONAL_MODULES.map((m) => m.key);
    expect(normalizeModuleSelection(all)).toEqual(all);
  });
});
