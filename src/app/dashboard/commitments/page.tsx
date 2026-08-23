import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";
import {
  ACTIVE_COMMITMENT_STATUSES,
  commitmentDueLabel,
  filterCommitments,
  groupByOwner,
  ownerFacets,
  shapeCommitments,
  splitBySide,
  type Commitment,
  type CommitmentFilters,
} from "@/lib/commitments";
import { Card, CardHeader, PageTitle } from "@/components/ui";

import { CommitmentFilters as FilterBar } from "./_filters";
import { LogCommitment } from "./_log";
import {
  contactOptionsSelect,
  loadStaffOptions,
  toContactOptions,
} from "./log-options";
import { type CommitmentRowData } from "./_commitment-row";
import { CommitmentList } from "./_commitment-list";

// Commitments (parity: commitmentsView 12617) — the follow-through workspace.
// Every action item, split by who owes it (our staff vs. a network contact) and
// ordered most-overdue-first. Three URL-state views: List (we owe / they owe),
// Board (kanban by staff owner + "They owe us"), and Completed (the done/dropped
// ledger). Search + urgency + owner chips filter the open set. One withOrg pass
// (RLS-scoped) loads the rows; the shaping/filtering is pure and unit-tested
// (@/lib/commitments).
//
// Scan (parity: scanForCommitments 12690) — the prototype's button re-read every
// meeting's notes to surface commitments. Here extraction is a persisted, per-
// meeting AI flow (see /dashboard/meetings), so instead of duplicating that
// review surface we point at the gap it fills: meetings that carry notes but
// have never had commitments pulled from them.

// A recorded meeting needs at least this much summary text to be worth scanning.
const MIN_NOTES = 20;

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule("commitments");
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const rawView = one(sp.view);
  const view = rawView === "board" || rawView === "completed" ? rawView : "list";
  // Scope (additive, default "everyone" so the shared workspace is unchanged):
  // "mine" narrows to the items this user personally owns — including undated
  // ones — so anyone can pull up their own outstanding follow-ups.
  const scope = one(sp.scope) === "mine" ? "mine" : "everyone";
  const rawUrgency = one(sp.urgency);
  const filters: CommitmentFilters = {
    q: one(sp.q),
    urgency: rawUrgency === "overdue" || rawUrgency === "soon" ? rawUrgency : "",
    owner: one(sp.owner),
  };

  const commitmentSelect = {
    id: true,
    text: true,
    status: true,
    dueDate: true,
    completionNote: true,
    ownerUser: { select: { id: true, name: true } },
    ownerContact: {
      select: {
        id: true,
        name: true,
        company: { select: { id: true, name: true } },
      },
    },
    meeting: { select: { title: true } },
  } as const;

  // Kicked off first so it runs alongside the RLS-scoped withOrg batch below.
  const staffPromise = loadStaffOptions(ctx.orgId);

  const [openRows, completedRows, contactRows, unscanned] = await withOrg(
    ctx.orgId,
    async (tx) => [
      // Every outstanding item (open + waiting) — stats, board, and owner facets
      // all need the full active set.
      await tx.actionItem.findMany({
        where: { status: { in: ACTIVE_COMMITMENT_STATUSES } },
        orderBy: { updatedAt: "desc" },
        select: commitmentSelect,
      }),
      // The resolved ledger is display-only; bound it to the most recent 50.
      await tx.actionItem.findMany({
        where: { status: { notIn: ACTIVE_COMMITMENT_STATUSES } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: commitmentSelect,
      }),
      // Contacts for the "they owe" picker on the log form.
      await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: contactOptionsSelect,
      }),
      // Meetings with notes but no commitments ever pulled — the scan gap.
      await tx.meeting.findMany({
        where: { summary: { not: null }, actionItems: { none: {} } },
        orderBy: { heldAt: "desc" },
        take: 8,
        select: { id: true, title: true, heldAt: true, summary: true },
      }),
    ],
  );
  const staff = await staffPromise;

  const now = new Date();
  // "Mine" = items I personally own (we-owe, ownerId === my user id). They-owe
  // items have no staff owner, so a mine view naturally drops them.
  const mine = (c: Commitment) => c.side === "we_owe" && c.ownerId === ctx.userId;
  const openAll = shapeCommitments(openRows, now);
  const completedAll = shapeCommitments(completedRows, now);
  const open = scope === "mine" ? openAll.filter(mine) : openAll;
  const completed = scope === "mine" ? completedAll.filter(mine) : completedAll;

  const openCount = open.length;
  const overdueCount = open.filter((c) => c.urgency === "overdue").length;
  const weOweCount = open.filter((c) => c.side === "we_owe").length;

  const owners = ownerFacets(open);
  const filteredOpen = filterCommitments(open, filters);
  const { weOwe, theyOwe } = splitBySide(filteredOpen);

  const contacts = toContactOptions(contactRows);

  const toScan = unscanned.filter(
    (m) => (m.summary ?? "").trim().length >= MIN_NOTES,
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Commitments"
          subtitle={`Open follow-ups across ${ctx.orgName}'s network`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Open" value={String(openCount)} />
        <Metric label="Overdue" value={String(overdueCount)} tone="red" />
        <Metric label="We owe" value={String(weOweCount)} />
        <Metric label="Completed" value={String(completed.length)} />
      </div>

      <LogCommitment staff={staff} contacts={contacts} />

      <FilterBar owners={owners} scope={scope} />

      {view === "list" && toScan.length > 0 ? (
        <Card>
          <CardHeader title={`Meetings to scan (${toScan.length})`} />
          <p className="px-4 pt-3 text-xs text-ink-3">
            These meetings have notes but no commitments yet. Open one to pull
            its action items.
          </p>
          <ul>
            {toScan.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{m.title}</div>
                  <div className="mt-0.5 text-[10px] text-ink-3">
                    {dateFmt.format(m.heldAt)}
                  </div>
                </div>
                <Link
                  href={`/dashboard/meetings#${m.id}`}
                  className="flex-shrink-0 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink hover:border-gold-line"
                >
                  Scan
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {view === "completed" ? (
        <CommitmentList
          title="Completed"
          rows={filterCommitments(completed, { q: filters.q, urgency: "", owner: "" }).map(toRow)}
          emptyLabel="Nothing resolved yet. Done and dismissed commitments land here."
          completed
        />
      ) : view === "board" ? (
        <BoardView weOwe={weOwe} theyOwe={theyOwe} />
      ) : (
        <>
          <CommitmentList
            title={scope === "mine" ? "My commitments" : "We owe"}
            rows={weOwe.map(toRow)}
            emptyLabel={
              scope === "mine"
                ? "Nothing outstanding assigned to you."
                : "Nothing outstanding on our side."
            }
            selectable
          />
          {scope === "everyone" ? (
            <CommitmentList
              title="They owe"
              rows={theyOwe.map(toRow)}
              emptyLabel="No open commitments from the network."
              selectable
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ── View shapes ─────────────────────────────────────────────────────────────

function toRow(c: Commitment): CommitmentRowData {
  const meta = [
    c.ownerName,
    c.companyName,
    c.meetingTitle ? `from ${c.meetingTitle}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  let dueLabel = "No due date";
  let dueOverdue = false;
  let dueTitle = "";
  if (c.dueDate !== null && c.dueInDays !== null) {
    dueOverdue = c.dueInDays < 0;
    dueLabel = commitmentDueLabel(c.dueInDays) ?? dueLabel;
    dueTitle = dateFmt.format(c.dueDate);
  }

  // Cross-links (parity: 13157) — jump from a commitment to the surfaces that
  // help you act on it, prefilled via the URL (URLSearchParams to match the
  // introductions ledger's draft-email link). Search always applies; the intro
  // links only make sense for a "they owe" item that carries a contact/company.
  const searchQuery = c.companyName ? `For ${c.companyName}: ${c.text}` : c.text;
  const searchHref = `/dashboard/network-search?${new URLSearchParams({ q: searchQuery })}`;
  const connectHref = c.companyId
    ? `/dashboard/introductions?${new URLSearchParams({ member: c.companyId })}#engine`
    : null;
  const logIntroHref = c.contactId
    ? `/dashboard/introductions?${new URLSearchParams({ logA: c.contactId, logText: c.text })}#log-intro`
    : null;

  return {
    id: c.id,
    text: c.text,
    meta,
    dueLabel,
    dueOverdue,
    dueTitle,
    dueDateInput: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : "",
    searchHref,
    connectHref,
    logIntroHref,
    // Only "they owe" items carry a contact to nudge; a we-owe item (staff owns
    // it) has no recipient. Same gate as logIntroHref.
    canNudge: c.contactId !== null,
    completionNote: c.completionNote,
  };
}

function BoardView({
  weOwe,
  theyOwe,
}: {
  weOwe: Commitment[];
  theyOwe: Commitment[];
}) {
  const columns = groupByOwner(weOwe);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <BoardColumn key={col.id} title={col.name} items={col.items} />
      ))}
      <BoardColumn title="They owe us" items={theyOwe} tone="teal" />
    </div>
  );
}

function BoardColumn({
  title,
  items,
  tone,
}: {
  title: string;
  items: Commitment[];
  tone?: "teal";
}) {
  return (
    <div className="w-[240px] shrink-0">
      <div className="mb-2 flex items-center justify-between border-b-2 border-line pb-1.5">
        <span
          className={`text-[9px] font-semibold tracking-[0.08em] uppercase ${
            tone === "teal" ? "text-teal-ink" : "text-ink-2"
          }`}
        >
          {title}
        </span>
        <span className="text-[10px] text-ink-3">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="px-1 text-[10px] text-ink-3 italic opacity-60">—</p>
        ) : (
          items.map((c) => <BoardCard key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}

function BoardCard({ c }: { c: Commitment }) {
  const overdue = c.dueInDays !== null && c.dueInDays < 0;
  const dueLabel = commitmentDueLabel(c.dueInDays);
  return (
    <div className="rounded-md border border-line bg-surface p-2.5 shadow-card">
      <div className="text-[12px] text-ink">{c.text}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ink-3">
        <span className="truncate">{c.companyName ?? c.ownerName}</span>
        {dueLabel ? (
          <span className={overdue ? "font-semibold text-red-ink" : ""}>
            {dueLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red";
}) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-card">
      <div
        className={`font-serif text-[18px] ${tone === "red" ? "text-red-ink" : "text-ink"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
    </div>
  );
}
