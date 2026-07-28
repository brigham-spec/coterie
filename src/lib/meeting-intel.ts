// Meeting-intelligence grounding for the introduction engine (S6c, item 14 —
// ports the prototype's buildFirefliesContext at Coterie.html:14275). Recent
// meeting summaries are the freshest signal of what a company needs RIGHT NOW —
// richer than the static profile fields — so before scoring introductions we
// condense the last few weeks of meetings into a compact block the model reads
// alongside the profiles. PURE — no DB, no secrets; the caller loads the rows.

export interface MeetingIntelEntry {
  title: string;
  heldAt: Date;
  summary: string | null;
  // Network companies discussed (derived from attendees). Empty when the caller
  // already scopes the meetings to a single focus, so "re:" would be redundant.
  companyNames: string[];
}

// The window and caps mirror the prototype: last 30 days, at most 15 meetings,
// each summary trimmed, and the whole block bounded so the prompt stays lean.
// MEETING_INTEL_MAX is exported so callers use it as the DB `take` — the query
// bound and the condenser's cap stay one number, not two hand-synced literals.
const WINDOW_DAYS = 30;
export const MEETING_INTEL_MAX = 15;
const MAX_SUMMARY_CHARS = 250;
const MAX_CONTEXT_CHARS = 5000;

/// PURE: the oldest heldAt a meeting can have to still count as recent. Callers
/// pass this as the DB `gte` bound so only in-window meetings are loaded.
export function meetingIntelCutoff(now: number = Date.now()): Date {
  return new Date(now - WINDOW_DAYS * 86_400_000);
}

/// PURE: condense recent meetings into a bounded context block for the intro
/// prompt, freshest first. Meetings without a usable summary contribute nothing,
/// so an all-empty set yields "" — the caller treats that as "no meeting
/// intelligence" (hides the badge, sends a profile-only prompt).
export function buildMeetingIntelContext(meetings: MeetingIntelEntry[]): string {
  const usable = meetings
    .filter((m) => (m.summary ?? "").trim() !== "")
    .sort((a, b) => b.heldAt.getTime() - a.heldAt.getTime())
    .slice(0, MEETING_INTEL_MAX);
  if (usable.length === 0) return "";

  const lines = [
    `RECENT MEETING INTELLIGENCE (last ${WINDOW_DAYS} days — ${usable.length} meetings):`,
  ];
  for (const m of usable) {
    const date = m.heldAt.toISOString().slice(0, 10);
    const re = m.companyNames.length > 0 ? ` — re: ${m.companyNames.join(", ")}` : "";
    lines.push(`\n[${date}] "${m.title}"${re}`);
    lines.push(
      `Key discussion: ${(m.summary ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_SUMMARY_CHARS)}`,
    );
  }
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}
