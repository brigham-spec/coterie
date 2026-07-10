import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { sumPayments } from "@/lib/invoice-status";
import {
  computeRevenueSummary,
  type MonthBucket,
  type QuarterBucket,
  type RevenueCompany,
  type RevenueInvoice,
  type RevenueProposal,
} from "@/lib/revenue";
import { Card, CardHeader, PageTitle, TagBadge } from "@/components/ui";

// Revenue analytics (slice 11.11, prototype revenueView Coterie.html:3580) — the
// billing ledger seen as money, not rows. One withOrg pass loads invoices (+their
// payments), the network roster, and the proposal pipeline; the pure rollup in
// @/lib/revenue derives every headline. This surface is read-only: creating
// invoices and marking them paid already live on the Invoices page, which each
// cash-flow figure links back to. Charts are plain CSS bars — no canvas/chart lib.

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Compact money for headline tiles: $1.2M / $340K / $0.
function money(n: number): string {
  if (n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return dollars.format(n);
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function loadRevenueData(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const invoices = await tx.invoice.findMany({
      include: {
        company: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    });
    const companies = await tx.company.findMany({
      select: { name: true, status: true, tier: true, annualValue: true },
    });
    const proposals = await tx.membershipProposal.findMany({
      select: {
        amount: true,
        status: true,
        sentOn: true,
        lastFollowUpAt: true,
        createdAt: true,
      },
    });
    return { invoices, companies, proposals };
  });
}

export default async function RevenuePage() {
  const ctx = await requireOrgContext();
  const { invoices, companies, proposals } = await loadRevenueData(ctx.orgId);
  const now = new Date();

  const revInvoices: RevenueInvoice[] = invoices.map((inv) => ({
    id: inv.id,
    companyName: inv.company.name,
    amount: Number(inv.amount),
    paid: Number(sumPayments(inv.payments)),
    dueOn: inv.dueOn,
    void: inv.status === "void",
  }));

  const revCompanies: RevenueCompany[] = companies.map((c) => ({
    name: c.name,
    status: c.status,
    tier: c.tier,
    annualValue: Number(c.annualValue),
  }));

  const revProposals: RevenueProposal[] = proposals.map((p) => ({
    amount: p.amount == null ? null : Number(p.amount),
    status: p.status,
    // Newest signal of life: last follow-up, else when it was sent, else created.
    lastActivityAt: p.lastFollowUpAt ?? p.sentOn ?? p.createdAt,
  }));

  const s = computeRevenueSummary(revInvoices, revCompanies, revProposals, now);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-2 flex items-center justify-between">
        <PageTitle
          title="Revenue"
          subtitle="Collections, cash flow, and recurring value across the network."
        />
        <Link
          href="/dashboard/invoices"
          className="shrink-0 text-[11px] text-ink-3 hover:text-gold"
        >
          Invoice ledger →
        </Link>
      </div>

      <div className="mt-5 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="Collected YTD"
          value={money(s.ytdCollected)}
          note={`${s.collectionRate}% of ${money(s.ytdScheduled)} scheduled`}
        />
        <Metric
          label="Past due"
          value={money(s.pastDueTotal)}
          note={`${s.overdue.length} invoice${s.overdue.length === 1 ? "" : "s"} outstanding`}
        />
        <Metric
          label="Due this month"
          value={money(s.dueThisMonthTotal)}
          note={`${money(s.dueThisMonthReceived)} received`}
        />
        <Metric
          label="Annual recurring"
          value={money(s.totalArr)}
          note={`${s.membersByRevenue.length} in-network`}
        />
        <Metric
          label="Full-year target"
          value={money(s.fullYearTarget)}
          note={`${now.getFullYear()} scheduled dues`}
        />
      </div>

      <Card>
        <CardHeader
          title="Proposal pipeline"
          action={<TagBadge tone="teal" label={`${s.proposals.total} total`} />}
        />
        <div className="grid grid-cols-3 gap-3 p-4">
          <Metric label="Won ARR" value={money(s.proposals.wonArr)} note="closed this pipeline" plain />
          <Metric label="Open pipeline" value={money(s.proposals.pipelineValue)} note="in negotiation" plain />
          <Metric
            label="Stale"
            value={String(s.proposals.staleCount)}
            note="no activity in 7+ days"
            plain
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Cash flow" />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <CashColumn
            title="Due this month"
            amount={money(s.dueThisMonthTotal)}
            note={`${money(s.dueThisMonthReceived)} received so far`}
            tone="teal"
          />
          <CashColumn
            title="Coming up"
            amount={money(s.dueNextMonthTotal)}
            note="due next month"
            tone="gold"
          />
          <CashColumn
            title="Past due"
            amount={money(s.pastDueTotal)}
            note={`${s.overdue.length} to collect`}
            tone="red"
          />
        </div>
        {s.overdue.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line">
            {s.overdue.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/invoices/${o.id}`}
                    className="text-[12.5px] font-medium text-ink hover:text-gold"
                  >
                    {o.companyName}
                  </Link>
                  <div className="mt-0.5 text-[10px] text-ink-3">
                    Due {dateFmt.format(o.dueOn)}
                  </div>
                </div>
                <div className="shrink-0 text-[12px] font-semibold text-red-ink">
                  {dollars.format(o.balance)}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Members by revenue"
          action={
            <TagBadge tone="teal" label={money(s.totalArr) + " ARR"} />
          }
        />
        {s.membersByRevenue.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No in-network companies yet. Set an annual value on a member profile
            to track recurring revenue.
          </p>
        ) : (
          <div className="space-y-2 p-4">
            {s.tierBreakdown.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {s.tierBreakdown.map((t) => (
                  <TagBadge
                    key={t.tier}
                    tone="slate"
                    label={`${t.tier}: ${t.count} · ${money(t.arr)}`}
                  />
                ))}
              </div>
            ) : null}
            {s.membersByRevenue.slice(0, 12).map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-[11.5px] text-ink">
                  {m.name}
                </div>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-2">
                  <div
                    className="h-full rounded-sm bg-teal-bg"
                    style={{ width: `${Math.max(m.pct, 2)}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right text-[11px] font-medium text-ink-2">
                  {money(m.annualValue)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly scheduled" />
          {s.months.length === 0 ? (
            <p className="px-4 py-6 text-xs text-ink-3">No invoices scheduled.</p>
          ) : (
            <MonthlyBars months={s.months} />
          )}
        </Card>

        <Card>
          <CardHeader title="Quarterly rollup" />
          {s.quarters.length === 0 ? (
            <p className="px-4 py-6 text-xs text-ink-3">No invoices scheduled.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 p-4">
              {s.quarters.map((q) => (
                <QuarterBox key={q.label} quarter={q} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MonthlyBars({ months }: { months: MonthBucket[] }) {
  const max = months.reduce((m, b) => Math.max(m, b.total), 0);
  return (
    <div className="space-y-1.5 p-4">
      {months.map((b) => (
        <div key={b.key} className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-[10.5px] text-ink-3">{b.label}</div>
          <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <div
              className="h-full rounded-sm bg-teal-bg"
              style={{ width: `${max > 0 ? Math.max((b.total / max) * 100, 2) : 0}%` }}
            />
          </div>
          <div className="w-14 shrink-0 text-right text-[10.5px] font-medium text-ink-2">
            {money(b.total)}
          </div>
        </div>
      ))}
    </div>
  );
}

const PHASE_STYLE: Record<QuarterBucket["phase"], { badge: "teal" | "gold" | "slate"; note: string }> = {
  past: { badge: "slate", note: "collected" },
  current: { badge: "teal", note: "current quarter" },
  projected: { badge: "gold", note: "projected" },
};

function QuarterBox({ quarter: q }: { quarter: QuarterBucket }) {
  const style = PHASE_STYLE[q.phase];
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-ink">{q.label}</span>
        <TagBadge tone={style.badge} label={style.note} />
      </div>
      <div className="mt-1 font-serif text-[16px] text-ink">{money(q.total)}</div>
      <div className="mt-0.5 text-[9.5px] text-ink-3">
        {q.invoiceCount} invoice{q.invoiceCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function CashColumn({
  title,
  amount,
  note,
  tone,
}: {
  title: string;
  amount: string;
  note: string;
  tone: "teal" | "gold" | "red";
}) {
  const bar =
    tone === "teal" ? "bg-teal-bg" : tone === "gold" ? "bg-gold-bg" : "bg-red-bg";
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className={`mb-2 h-1 w-8 rounded-full ${bar}`} />
      <div className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {title}
      </div>
      <div className="mt-1 font-serif text-[18px] text-ink">{amount}</div>
      <div className="mt-0.5 text-[9.5px] text-ink-3">{note}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  plain,
}: {
  label: string;
  value: string;
  note: string;
  plain?: boolean;
}) {
  return (
    <div
      className={
        plain
          ? ""
          : "rounded-md border border-line bg-surface px-4 py-3 shadow-card"
      }
    >
      <div className="font-serif text-[18px] text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-[9.5px] text-ink-3">{note}</div>
    </div>
  );
}
