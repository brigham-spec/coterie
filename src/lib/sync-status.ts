// Fireflies sync-status classifier (gap-audit cluster B). PURE — no I/O — so the
// dashboard card's health tone is derived from just three inputs and is directly
// testable. The prototype rendered a thin "last synced Xh ago" bar (Coterie.html
// :3116); in the production model the sync is a durable background job, so the
// honest signal is the persisted last-sync timestamp (see IntegrationCredential
// .lastSyncedAt, stamped at the end of syncFireflies).
//
// A connected integration that has not synced in over a week is "stale" — the
// operator has likely stopped running syncs and their meeting data is drifting.

import {
  dedupeMembers,
  type MeetingMember,
  type RawMeetingForView,
} from "@/lib/meetings-view";

export type SyncHealth = "disconnected" | "never" | "fresh" | "stale";

export interface SyncStatus {
  health: SyncHealth;
  lastSyncedAt: Date | null;
  ageMs: number | null;
}

// A week without a sync flips a connected integration from fresh to stale.
export const STALE_MS = 7 * 86_400_000;

// How far back the meeting-count + member pills reach. A distinct policy from the
// staleness threshold — both are a week today, but a named constant keeps tuning
// one from silently moving the other.
export const RECENT_SYNC_WINDOW_MS = STALE_MS;

// Turn a Fireflies transport failure into a specific, actionable message for the
// "Sync now" button. A 401/403 means the stored key is bad — the one thing the
// operator can fix by reconnecting — so it gets its own line; everything else
// passes Fireflies' own message through. PURE (takes the status + message, not
// the server-only FirefliesError class) so it stays testable here.
export function firefliesSyncErrorMessage(
  status: number | null,
  rawMessage: string,
): string {
  if (status === 401 || status === 403)
    return "Fireflies rejected your API key. Reconnect with a valid key.";
  return `Fireflies error: ${rawMessage}`;
}

// Has a durable sync finished since we kicked it off? The "Sync now" button
// captures the last-sync timestamp (ms) BEFORE enqueuing the background job,
// then polls; the job advancing lastSyncedAt past that baseline is the honest
// completion signal. A null baseline means "never synced before", so the first
// non-null reading is itself completion. PURE so the polling client can lean on
// a tested predicate rather than inlining the comparison.
export function syncCompleted(
  sinceMs: number | null,
  currentMs: number | null,
): boolean {
  if (currentMs == null) return false;
  return sinceMs == null || currentMs > sinceMs;
}

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

// Post-sync summary for the status bar's meeting-count + member pills (parity:
// the prototype's "N new meetings synced" line and clickable updated-member tags,
// Coterie.html:3132). The durable-job model has no ephemeral "just synced" state,
// so we derive the same signal from the meetings that landed in the freshness
// window: how many synced meetings, and which network companies they touched.
// The per-meeting company dedupe (a firm with two attendees counts once) is the
// same one the Meetings workspace uses, so we reuse it and its shapes.

export interface RecentSyncMember extends MeetingMember {
  /// How many of the recent synced meetings this company appeared in.
  count: number;
}

export interface RecentSyncSummary {
  meetingCount: number;
  /// Companies touched, sorted by meeting count desc then name.
  members: RecentSyncMember[];
}

/// The raw shape the summarizer reads — one entry per recently synced meeting.
export type RawSyncedMeeting = Pick<RawMeetingForView, "attendees">;

export function summarizeRecentSync(
  meetings: RawSyncedMeeting[],
): RecentSyncSummary {
  const byCompany = new Map<string, RecentSyncMember>();
  for (const m of meetings) {
    // dedupeMembers gives the distinct companies for this meeting; tally how
    // many meetings each one appears in.
    for (const co of dedupeMembers(m.attendees)) {
      const existing = byCompany.get(co.id);
      if (existing) existing.count += 1;
      else byCompany.set(co.id, { id: co.id, name: co.name, count: 1 });
    }
  }
  const members = [...byCompany.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  return { meetingCount: meetings.length, members };
}
