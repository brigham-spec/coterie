// Meetings workspace — PURE derivation for the meetings list (parity: Meet 8/9/10).
// A meeting is org-level with matched attendees; from those we derive its "members"
// (the distinct network companies represented — deduped, so a meeting with two
// contacts at the same firm carries that firm once), its source (Fireflies sync vs.
// a manually logged meeting), a collapsed-card preview, the stats bar, and the
// keyword/source/member filters. No I/O — the page loads rows withOrg and maps them
// to MeetingView so the filtering/stats are unit-tested.

export type MeetingSource = "fireflies" | "manual";

export interface MeetingMember {
  id: string;
  name: string;
}

export interface MeetingView {
  id: string;
  title: string;
  summary: string | null;
  source: MeetingSource;
  /// Distinct companies across the attendees, sorted by name (the member tags).
  members: MeetingMember[];
}

/// The raw attendee shape the mapper reads.
export interface RawMeetingForView {
  id: string;
  title: string;
  summary: string | null;
  firefliesId: string | null;
  attendees: { contact: { company: { id: string; name: string } } }[];
}

export interface MeetingFilters {
  q: string;
  source: "" | "fireflies" | "manual";
  /// A company id, or "" for all members.
  member: string;
}

export interface MeetingStats {
  total: number;
  fireflies: number;
  manual: number;
  members: number;
}

/// Distinct companies across a meeting's attendees, sorted by name — the dedup at
/// the heart of Meet 9 (one tag per firm no matter how many of its contacts attended).
export function dedupeMembers(
  attendees: { contact: { company: { id: string; name: string } } }[],
): MeetingMember[] {
  const map = new Map<string, MeetingMember>();
  for (const a of attendees) {
    const co = a.contact.company;
    if (!map.has(co.id)) map.set(co.id, { id: co.id, name: co.name });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function toMeetingView(raw: RawMeetingForView): MeetingView {
  return {
    id: raw.id,
    title: raw.title,
    summary: raw.summary,
    source: raw.firefliesId ? "fireflies" : "manual",
    members: dedupeMembers(raw.attendees),
  };
}

/// Keyword (title + summary), source, and member filters. Member matches when any
/// of the meeting's companies is the selected one.
export function matchesMeetingFilters(v: MeetingView, f: MeetingFilters): boolean {
  if (f.source && v.source !== f.source) return false;
  if (f.member && !v.members.some((m) => m.id === f.member)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${v.title} ${v.summary ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/// The distinct companies across every meeting, sorted by name — the member filter
/// options.
export function meetingMemberFacets(views: MeetingView[]): MeetingMember[] {
  const map = new Map<string, MeetingMember>();
  for (const v of views) {
    for (const m of v.members) if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function meetingStats(views: MeetingView[]): MeetingStats {
  const members = new Set<string>();
  let fireflies = 0;
  for (const v of views) {
    if (v.source === "fireflies") fireflies += 1;
    for (const m of v.members) members.add(m.id);
  }
  return {
    total: views.length,
    fireflies,
    manual: views.length - fireflies,
    members: members.size,
  };
}

/// A short preview for a collapsed card: the first two sentences of the summary,
/// trimmed. Empty when there's no summary.
export function meetingPreview(summary: string | null, sentences = 2): string {
  const text = (summary ?? "").trim();
  if (text === "") return "";
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text;
  const preview = parts
    .slice(0, sentences)
    .map((s) => s.trim())
    .join(" ");
  return preview === "" ? text : preview;
}
