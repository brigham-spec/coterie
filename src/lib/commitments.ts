// Commitments — the follow-through surface (parity: commitmentsView 12617). A
// commitment is an open action item: exactly one side owes it (the org's staff
// = "we owe", or a network contact = "they owe" — enforced by the action_items
// owner-XOR CHECK). This module is the PURE shaping logic: classify each item by
// side, compute how overdue it is, sort most-overdue-first, and count. No I/O —
// the page reads rows withOrg and hands them here so the ordering is unit-tested.

const DAY = 86_400_000;

/// A raw open action item as loaded from the DB (owner relations + source
/// meeting). Owner-XOR means exactly one of ownerUser / ownerContact is set.
export interface RawCommitment {
  id: string;
  text: string;
  dueDate: Date | null;
  ownerUser: { name: string } | null;
  ownerContact: { name: string; company: { name: string } } | null;
  meeting: { title: string } | null;
}

/// A shaped commitment ready to render.
export interface Commitment {
  id: string;
  text: string;
  ownerName: string;
  /// The contact's company for a "they owe" item; null for "we owe".
  companyName: string | null;
  meetingTitle: string | null;
  dueDate: Date | null;
  /// Signed days until due: negative = overdue, 0 = due today, positive = upcoming,
  /// null = no due date. Drives both the sort order and the overdue styling.
  dueInDays: number | null;
}

export interface CommitmentBoard {
  /// Owed by the org's staff, most-overdue first.
  weOwe: Commitment[];
  /// Owed by network contacts, most-overdue first.
  theyOwe: Commitment[];
  openCount: number;
  overdueCount: number;
}

/// Whole days from `now` until `due` (negative once past due). Both are floored
/// to midnight so "due today" is 0 regardless of the time component.
function dueInDays(now: Date, due: Date): number {
  const startNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const startDue = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((startDue - startNow) / DAY);
}

/// Most-overdue-first: dated items ascending by dueInDays (most negative wins),
/// undated items last, ties broken by text for a stable order.
function byUrgency(a: Commitment, b: Commitment): number {
  if (a.dueInDays === null && b.dueInDays === null)
    return a.text.localeCompare(b.text);
  if (a.dueInDays === null) return 1;
  if (b.dueInDays === null) return -1;
  if (a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
  return a.text.localeCompare(b.text);
}

/// Classify, enrich, sort, and count. Items with neither owner set are skipped
/// (the XOR CHECK makes that unreachable in practice, but stay defensive against
/// a malformed row rather than render an owner-less commitment).
export function buildCommitmentBoard(
  rows: RawCommitment[],
  now: Date,
): CommitmentBoard {
  const weOwe: Commitment[] = [];
  const theyOwe: Commitment[] = [];
  let overdueCount = 0;

  for (const row of rows) {
    const days = row.dueDate === null ? null : dueInDays(now, row.dueDate);
    if (days !== null && days < 0) overdueCount += 1;

    if (row.ownerUser !== null) {
      weOwe.push({
        id: row.id,
        text: row.text,
        ownerName: row.ownerUser.name,
        companyName: null,
        meetingTitle: row.meeting?.title ?? null,
        dueDate: row.dueDate,
        dueInDays: days,
      });
    } else if (row.ownerContact !== null) {
      theyOwe.push({
        id: row.id,
        text: row.text,
        ownerName: row.ownerContact.name,
        companyName: row.ownerContact.company.name,
        meetingTitle: row.meeting?.title ?? null,
        dueDate: row.dueDate,
        dueInDays: days,
      });
    }
  }

  weOwe.sort(byUrgency);
  theyOwe.sort(byUrgency);

  return {
    weOwe,
    theyOwe,
    openCount: weOwe.length + theyOwe.length,
    overdueCount,
  };
}
