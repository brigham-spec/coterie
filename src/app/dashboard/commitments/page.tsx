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

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export default async function CommitmentsPage() {
  const ctx = await requireOrgContext();

  const rows = await withOrg(ctx.orgId, (tx) =>
    tx.actionItem.findMany({
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
  );

  const board = buildCommitmentBoard(rows, new Date());

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
