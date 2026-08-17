import { describe, expect, test } from "vitest";

import { resolveScope } from "@/lib/dashboard-scope";

// Pure-logic tests for the dashboard scope clamp. The single guarantee that
// matters for tenant safety: a non-admin can never resolve to "everyone", no
// matter what they request; an admin defaults to their own work and opts into
// org-wide.

describe("resolveScope", () => {
  test("admin with no request defaults to mine", () => {
    expect(resolveScope(true, undefined)).toBe("mine");
  });

  test("admin honors an explicit mine request", () => {
    expect(resolveScope(true, "mine")).toBe("mine");
  });

  test("admin honors an explicit everyone request", () => {
    expect(resolveScope(true, "everyone")).toBe("everyone");
  });

  test("admin with an unknown value falls back to mine", () => {
    expect(resolveScope(true, "bogus")).toBe("mine");
  });

  test("staff is pinned to mine regardless of request", () => {
    expect(resolveScope(false, "everyone")).toBe("mine");
    expect(resolveScope(false, "mine")).toBe("mine");
    expect(resolveScope(false, undefined)).toBe("mine");
    expect(resolveScope(false, "bogus")).toBe("mine");
  });
});
