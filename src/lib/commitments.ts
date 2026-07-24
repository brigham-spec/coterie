// Commitments — the follow-through surface (parity: commitmentsView 12617). A
// commitment is an action item: exactly one side owes it (the org's staff = "we
// owe", ownerUser; or a network contact = "they owe", ownerContact — enforced by
// the action_items owner-XOR CHECK). This module is the PURE shaping logic:
// classify each item by side, compute how overdue it is, bucket urgency, apply
// the workspace filters, and group for the board. No I/O — the page reads rows
// withOrg and hands them here so the ordering/filtering is unit-tested.

const DAY = 86_400_000;

export type CommitmentStatus = "open" | "done" | "dropped";
export const COMMITMENT_STATUSES: CommitmentStatus[] = ["open", "done", "dropped"];

/// Urgency buckets drive the filter chips and the overdue styling. `soon` is the
/// next week (due today through +7d); `later` is further out; `none` is undated.
export type CommitmentUrgency = "overdue" | "soon" | "later" | "none";

/// A raw action item as loaded from the DB (owner relations + source meeting).
/// Owner-XOR means exactly one of ownerUser / ownerContact is set.
export interface RawCommitment {
  id: string;
  text: string;
  status: string;
  dueDate: Date | null;
  ownerUser: { id: string; name: string } | null;
  ownerContact: { name: string; company: { name: string } } | null;
  meeting: { title: string } | null;
}

/// A shaped commitment ready to render.
export interface Commitment {
  id: string;
  text: string;
  /// Which side owes it — set from which owner relation is present.
  side: "we_owe" | "they_owe";
  /// The staff owner's user id for a "we owe" item (drives the board columns and
  /// owner filter chips); null for "they owe".
  ownerId: string | null;
  ownerName: string;
  /// The contact's company for a "they owe" item; null for "we owe".
  companyName: string | null;
  meetingTitle: string | null;
  dueDate: Date | null;
  /// Signed days until due: negative = overdue, 0 = due today, positive = upcoming,
  /// null = no due date. Drives both the sort order and the overdue styling.
  dueInDays: number | null;
  urgency: CommitmentUrgency;
  status: CommitmentStatus;
}

/// The workspace filter state, mirrored to the URL query string.
export interface CommitmentFilters {
  q: string;
  /// "" = all; otherwise restrict to that urgency bucket.
  urgency: "" | "overdue" | "soon";
  /// A staff owner id, or "" for all owners.
  owner: string;
}

export interface OwnerFacet {
  id: string;
  name: string;
  count: number;
}

export interface OwnerColumn {
  id: string;
  name: string;
  items: Commitment[];
}

/// Whole days from `now` until `due` (negative once past due). Both anchors are
/// floored to their UTC calendar day so "due today" is 0 regardless of the time
/// component. `dueDate` is a @db.Date (UTC-midnight instant), so `now` must be
/// read on the same UTC calendar or the delta skews by a day in non-UTC zones.
function dueInDays(now: Date, due: Date): number {
  const startNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startDue = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((startDue - startNow) / DAY);
}

function urgencyOf(days: number | null): CommitmentUrgency {
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days <= 7) return "soon";
  return "later";
}

/// The short due-date badge from a signed days-until-due: "3d overdue" / "Due
/// today" / "Due in 5d", or null when undated. Shared by the list rows and the
/// board cards.
export function commitmentDueLabel(dueInDays: number | null): string | null {
  if (dueInDays === null) return null;
  if (dueInDays < 0) return `${Math.abs(dueInDays)}d overdue`;
  if (dueInDays === 0) return "Due today";
  return `Due in ${dueInDays}d`;
}

function toStatus(raw: string): CommitmentStatus {
  return raw === "done" || raw === "dropped" ? raw : "open";
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

/// Classify and enrich every row. Items with neither owner set are skipped (the
/// XOR CHECK makes that unreachable in practice, but stay defensive against a
/// malformed row rather than render an owner-less commitment). Order is preserved;
/// callers sort per view.
export function shapeCommitments(rows: RawCommitment[], now: Date): Commitment[] {
  const out: Commitment[] = [];
  for (const row of rows) {
    const days = row.dueDate === null ? null : dueInDays(now, row.dueDate);
    const base = {
      id: row.id,
      text: row.text,
      meetingTitle: row.meeting?.title ?? null,
      dueDate: row.dueDate,
      dueInDays: days,
      urgency: urgencyOf(days),
      status: toStatus(row.status),
    };
    if (row.ownerUser !== null) {
      out.push({
        ...base,
        side: "we_owe",
        ownerId: row.ownerUser.id,
        ownerName: row.ownerUser.name,
        companyName: null,
      });
    } else if (row.ownerContact !== null) {
      out.push({
        ...base,
        side: "they_owe",
        ownerId: null,
        ownerName: row.ownerContact.name,
        companyName: row.ownerContact.company.name,
      });
    }
  }
  return out;
}

/// Apply the workspace filters: urgency bucket, staff owner, and a case-insensitive
/// substring search across text/owner/company/source-meeting. An owner filter only
/// matches "we owe" items (contacts have no staff owner id).
export function filterCommitments(
  items: Commitment[],
  f: CommitmentFilters,
): Commitment[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((c) => {
    if (f.urgency === "overdue" && c.urgency !== "overdue") return false;
    if (f.urgency === "soon" && c.urgency !== "soon") return false;
    if (f.owner && c.ownerId !== f.owner) return false;
    if (q) {
      const hay = `${c.text} ${c.ownerName} ${c.companyName ?? ""} ${c.meetingTitle ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/// Split into the two owed-by sides, each sorted most-overdue-first.
export function splitBySide(items: Commitment[]): {
  weOwe: Commitment[];
  theyOwe: Commitment[];
} {
  const weOwe = items.filter((c) => c.side === "we_owe").sort(byUrgency);
  const theyOwe = items.filter((c) => c.side === "they_owe").sort(byUrgency);
  return { weOwe, theyOwe };
}

/// The distinct staff owners across a set of commitments, with counts — the owner
/// filter chips. Sorted by name so the chip order is stable.
export function ownerFacets(items: Commitment[]): OwnerFacet[] {
  const map = new Map<string, OwnerFacet>();
  for (const c of items) {
    if (c.side !== "we_owe" || c.ownerId === null) continue;
    const cur = map.get(c.ownerId) ?? { id: c.ownerId, name: c.ownerName, count: 0 };
    cur.count += 1;
    map.set(c.ownerId, cur);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/// Group "we owe" items into per-owner board columns (already sorted within each
/// column by the caller's splitBySide). Sorted by owner name for a stable board.
export function groupByOwner(weOwe: Commitment[]): OwnerColumn[] {
  const map = new Map<string, OwnerColumn>();
  for (const c of weOwe) {
    if (c.ownerId === null) continue;
    const col = map.get(c.ownerId) ?? { id: c.ownerId, name: c.ownerName, items: [] };
    col.items.push(c);
    map.set(c.ownerId, col);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
