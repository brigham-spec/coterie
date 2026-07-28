import { describe, it, expect } from "vitest";

import {
  PROACTIVE_CACHE_TTL_MS,
  isProactiveCacheFresh,
} from "@/lib/proactive-cache";

// Unit test for the proactive-scan cache freshness gate (S6c, item 13). Pure and
// clock-injected — it decides whether the Urgent Signals panel renders the cache
// as-is or auto-fires a rescan. Guards the boundary conditions the prototype's 4h
// window (Coterie.html:14568) hinged on.

describe("isProactiveCacheFresh", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  it("is fresh just inside the TTL window", () => {
    const gen = new Date(now - (PROACTIVE_CACHE_TTL_MS - 1));
    expect(isProactiveCacheFresh(gen, now)).toBe(true);
  });

  it("is stale exactly at the TTL boundary", () => {
    const gen = new Date(now - PROACTIVE_CACHE_TTL_MS);
    expect(isProactiveCacheFresh(gen, now)).toBe(false);
  });

  it("is stale past the TTL window", () => {
    const gen = new Date(now - (PROACTIVE_CACHE_TTL_MS + 60_000));
    expect(isProactiveCacheFresh(gen, now)).toBe(false);
  });

  it("treats a future timestamp (clock skew) as fresh", () => {
    const gen = new Date(now + 60_000);
    expect(isProactiveCacheFresh(gen, now)).toBe(true);
  });

  it("treats an absent timestamp as not fresh", () => {
    expect(isProactiveCacheFresh(null, now)).toBe(false);
    expect(isProactiveCacheFresh(undefined, now)).toBe(false);
  });
});
