import { describe, expect, test } from "vitest";

import {
  classifySyncStatus,
  summarizeRecentSync,
  firefliesSyncErrorMessage,
  syncCompleted,
  STALE_MS,
  type RawSyncedMeeting,
} from "@/lib/sync-status";

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

// A recently synced meeting attended by the given companies (each entry becomes
// one attendee); repeat a company to simulate two of its contacts attending.
function meeting(companies: { id: string; name: string }[]): RawSyncedMeeting {
  return { attendees: companies.map((company) => ({ contact: { company } })) };
}

describe("summarizeRecentSync", () => {
  const acme = { id: "a", name: "Acme" };
  const beta = { id: "b", name: "Beta" };
  const zeta = { id: "z", name: "Zeta" };

  test("returns an empty summary for no meetings", () => {
    expect(summarizeRecentSync([])).toEqual({ meetingCount: 0, members: [] });
  });

  test("counts a company once per meeting even with two attendees", () => {
    const result = summarizeRecentSync([meeting([acme, acme])]);
    expect(result.meetingCount).toBe(1);
    expect(result.members).toEqual([{ id: "a", name: "Acme", count: 1 }]);
  });

  test("tallies across meetings and sorts by count desc then name", () => {
    const result = summarizeRecentSync([
      meeting([acme, beta]),
      meeting([acme, zeta]),
      meeting([acme]),
    ]);
    expect(result.meetingCount).toBe(3);
    // Acme in all 3; Beta and Zeta once each — ties break by name (Beta<Zeta).
    expect(result.members).toEqual([
      { id: "a", name: "Acme", count: 3 },
      { id: "b", name: "Beta", count: 1 },
      { id: "z", name: "Zeta", count: 1 },
    ]);
  });
});

describe("syncCompleted", () => {
  test("a null current clock is never complete (job hasn't stamped yet)", () => {
    expect(syncCompleted(null, null)).toBe(false);
    expect(syncCompleted(1000, null)).toBe(false);
  });

  test("first sync ever completes as soon as a clock appears", () => {
    // Null baseline = never synced before; any reading is our completion.
    expect(syncCompleted(null, 1000)).toBe(true);
  });

  test("the clock must advance strictly past the baseline", () => {
    expect(syncCompleted(1000, 1000)).toBe(false); // unchanged — still running
    expect(syncCompleted(1000, 1001)).toBe(true); // advanced — done
    expect(syncCompleted(1000, 999)).toBe(false); // stale reading
  });
});

describe("firefliesSyncErrorMessage", () => {
  test("a rejected key (401/403) gets a specific reconnect message", () => {
    const reconnect = "Fireflies rejected your API key. Reconnect with a valid key.";
    expect(firefliesSyncErrorMessage(401, "Unauthorized")).toBe(reconnect);
    expect(firefliesSyncErrorMessage(403, "Forbidden")).toBe(reconnect);
  });

  test("any other failure passes Fireflies' own message through", () => {
    expect(firefliesSyncErrorMessage(500, "Server error")).toBe(
      "Fireflies error: Server error",
    );
    expect(firefliesSyncErrorMessage(null, "GraphQL boom")).toBe(
      "Fireflies error: GraphQL boom",
    );
  });
});
