import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { buildCommitmentBoard, type Commitment } from "@/lib/commitments";
import { Button, Card, CardHeader, PageTitle } from "@/components/ui";

import { updateCommitment } from "./actions";

// Commitments (parity: commitmentsView 12617) — the follow-through queue. Every
// open action item, split by who owes it (our staff vs. a network contact) and
// ordered most-overdue-first so the thing that has slipped furthest is on top.
// Check-off (done) or dismiss (dropped) each from here; source meeting is shown
// for context. One withOrg pass (RLS-scoped); the ordering lives in a pure,
// unit-tested helper (@/lib/commitments).
//
// Scan (parity: scanForCommitments 12690) — the prototype's button re-read every
// meeting's notes to surface commitments. Here extraction is a persisted, per-
// meeting AI flow (see /dashboard/meetings), so instead of duplicating that
// review surface we point at the gap it fills: meetings that carry notes but
// have never had commitments pulled from them. Each links to the meetings page
// where the existing extract/review/save flow lives.

// A recorded meeting needs at least this much summary text to be worth scanning.
const MIN_NOTES = 20;

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export default async function CommitmentsPage() {
  const ctx = await requireOrgContext();

  const [rows, unscanned] = await withOrg(ctx.orgId, async (tx) => [
    await tx.actionItem.findMany({
      where: { status: "open" },
      select: {
        id: true,
        text: true,
        dueDate: true,
        ownerUser: { select: { name: true } },
        ownerContact: {
          select: { name: true, company: { select: { name: true } } },
        },
        meeting: { select: { title: true } },
      },
    }),
    // Meetings with notes but no commitments ever pulled — the scan gap.
    await tx.meeting.findMany({
      where: { summary: { not: null }, actionItems: { none: {} } },
      orderBy: { heldAt: "desc" },
      take: 8,
      select: { id: true, title: true, heldAt: true, summary: true },
    }),
  ]);

  const board = buildCommitmentBoard(rows, new Date());

  // A whitespace-only summary is not worth surfacing.
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

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Metric label="Open" value={String(board.openCount)} />
        <Metric label="Overdue" value={String(board.overdueCount)} tone="red" />
        <Metric label="We owe" value={String(board.weOwe.length)} />
      </div>

      {toScan.length > 0 ? (
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
                  href="/dashboard/meetings"
                  className="flex-shrink-0 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink hover:border-gold-line"
                >
                  Scan
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Section title="We owe" items={board.weOwe} emptyLabel="Nothing outstanding on our side." />
      <Section
        title="They owe"
        items={board.theyOwe}
        emptyLabel="No open commitments from the network."
      />
    </div>
  );
}

function Section({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: Commitment[];
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader title={`${title} (${items.length})`} />
      {items.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">{emptyLabel}</p>
      ) : (
        <ul>
          {items.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">{c.text}</div>
                <div className="mt-0.5 text-[10px] text-ink-3">
                  {c.ownerName}
                  {c.companyName ? ` · ${c.companyName}` : ""}
                  {c.meetingTitle ? ` · from ${c.meetingTitle}` : ""}
                </div>
              </div>
              <Due c={c} />
              <div className="flex flex-shrink-0 gap-1.5">
                <form action={updateCommitment}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="status" value="done" />
                  <Button type="submit" variant="primary">
                    Done
                  </Button>
                </form>
                <form action={updateCommitment}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="status" value="dropped" />
                  <Button type="submit">Dismiss</Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Due({ c }: { c: Commitment }) {
  if (c.dueDate === null || c.dueInDays === null) {
    return (
      <span className="flex-shrink-0 self-center text-[10px] whitespace-nowrap text-ink-3">
        No due date
      </span>
    );
  }
  const overdue = c.dueInDays < 0;
  const label =
    c.dueInDays < 0
      ? `${Math.abs(c.dueInDays)}d overdue`
      : c.dueInDays === 0
        ? "Due today"
        : `Due in ${c.dueInDays}d`;
  return (
    <span
      className={`flex-shrink-0 self-center text-right text-[10px] whitespace-nowrap ${
        overdue ? "font-semibold text-red-ink" : "text-ink-3"
      }`}
      title={dateFmt.format(c.dueDate)}
    >
      {label}
    </span>
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
