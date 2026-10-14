import { describe, expect, test } from "vitest";

import { reconcileOrder } from "@/lib/card-order";

// Pure order reconciliation for the movable company-profile tiles: a saved order
// (this browser's localStorage) replayed against the cards present this render.

describe("reconcileOrder", () => {
  test("empty saved → natural order", () => {
    expect(reconcileOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("applies a full saved order", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("drops stale ids no longer present", () => {
    expect(reconcileOrder(["x", "b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });

  test("appends new ids in natural order after the saved ones", () => {
    expect(reconcileOrder(["b"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  test("ignores duplicates in the saved list", () => {
    expect(reconcileOrder(["a", "a", "b"], ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
