import { describe, expect, test } from "vitest";

import { classifySyncStatus, STALE_MS } from "@/lib/sync-status";

// Pure-logic tests for the Fireflies sync-status classifier: a disconnected
// integration, a connected-but-never-synced one, and the fresh/stale split at
// the one-week boundary (inclusive of the boundary itself).

const NOW = new Date("2026-07-10T12:00:00Z");

describe("classifySyncStatus", () => {
  test("not connected reports disconnected and carries no timestamp", () => {
    const s = classifySyncStatus(false, null, NOW);
    expect(s).toEqual({ health: "disconnected", lastSyncedAt: null, ageMs: null });
  });

  test("a foreign last-sync is ignored while disconnected", () => {
    // Even if a stale timestamp lingered, a disconnected integration never
    // surfaces it.
    const s = classifySyncStatus(false, new Date(NOW.getTime() - STALE_MS), NOW);
    expect(s.health).toBe("disconnected");
    expect(s.lastSyncedAt).toBeNull();
  });

  test("connected but never synced reports never", () => {
    const s = classifySyncStatus(true, null, NOW);
    expect(s).toEqual({ health: "never", lastSyncedAt: null, ageMs: null });
  });

  test("a recent sync is fresh and reports its age", () => {
    const lastSyncedAt = new Date(NOW.getTime() - 3_600_000); // an hour ago
    const s = classifySyncStatus(true, lastSyncedAt, NOW);
    expect(s.health).toBe("fresh");
    expect(s.lastSyncedAt).toBe(lastSyncedAt);
    expect(s.ageMs).toBe(3_600_000);
  });

  test("exactly at the stale boundary is stale", () => {
    const s = classifySyncStatus(true, new Date(NOW.getTime() - STALE_MS), NOW);
    expect(s.health).toBe("stale");
    expect(s.ageMs).toBe(STALE_MS);
  });

  test("just under the boundary is still fresh", () => {
    const s = classifySyncStatus(true, new Date(NOW.getTime() - STALE_MS + 1), NOW);
    expect(s.health).toBe("fresh");
  });
});
