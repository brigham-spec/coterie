// Fireflies sync-status classifier (gap-audit cluster B). PURE — no I/O — so the
// dashboard card's health tone is derived from just three inputs and is directly
// testable. The prototype rendered a thin "last synced Xh ago" bar (Coterie.html
// :3116); in the production model the sync is a durable background job, so the
// honest signal is the persisted last-sync timestamp (see IntegrationCredential
// .lastSyncedAt, stamped at the end of syncFireflies).
//
// A connected integration that has not synced in over a week is "stale" — the
// operator has likely stopped running syncs and their meeting data is drifting.

export type SyncHealth = "disconnected" | "never" | "fresh" | "stale";

export interface SyncStatus {
  health: SyncHealth;
  lastSyncedAt: Date | null;
  ageMs: number | null;
}

// A week without a sync flips a connected integration from fresh to stale.
export const STALE_MS = 7 * 86_400_000;

export function classifySyncStatus(
  connected: boolean,
  lastSyncedAt: Date | null,
  now: Date,
): SyncStatus {
  if (!connected) return { health: "disconnected", lastSyncedAt: null, ageMs: null };
  if (lastSyncedAt == null)
    return { health: "never", lastSyncedAt: null, ageMs: null };
  const ageMs = now.getTime() - lastSyncedAt.getTime();
  return {
    health: ageMs >= STALE_MS ? "stale" : "fresh",
    lastSyncedAt,
    ageMs,
  };
}
