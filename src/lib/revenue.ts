import { NETWORK_STATUSES } from "@/lib/company-statuses";

// Revenue analytics rollup (slice 11.11, prototype revenueView Coterie.html:3580).
// PURE — no I/O, plain numbers in (the page converts Prisma.Decimal → number) —
// so every headline figure is directly testable. Derived entirely from the
// existing billing ledger (invoices + payments), the network roster (company
// annualValue), and the proposal pipeline; this slice adds NO new mutation seam
// (creating invoices and marking them paid already live on the Invoices surface).
//
// Money follows the ledger's own rules: "void" invoices are never owed and drop
// out of every total, and an invoice's collected amount is capped at its face
// value so an overpayment can't inflate collection above 100%. Date bucketing
// uses local calendar boundaries to match the dashboard's revenue snapshot.

export interface RevenueInvoice {
  id: string;
  companyName: string;
  amount: number;
  paid: number;
  dueOn: Date;
  void: boolean;
}

export interface RevenueCompany {
  name: string;
  status: string;
  tier: string | null;
  annualValue: number;
}

export interface RevenueProposal {
  amount: number | null;
  status: string;
  // Newest of sentOn / lastFollowUpAt / createdAt, resolved by the caller.
  lastActivityAt: Date | null;
}

export interface OverdueInvoice {
  id: string;
  companyName: string;
  dueOn: Date;
  balance: number;
}

export interface MonthBucket {
  key: string;
  label: string;
  year: number;
  month: number; // 0-based
  total: number;
}

export type QuarterPhase = "past" | "current" | "projected";

export interface QuarterBucket {
  label: string;
  total: number;
  invoiceCount: number;
  phase: QuarterPhase;
}

export interface TierArr {
  tier: string;
  count: number;
  arr: number;
}

export interface MemberRevenue {
  name: string;
  tier: string | null;
  annualValue: number;
  pct: number;
}

export interface ProposalPipeline {
  total: number;
  wonArr: number;
  pipelineValue: number;
  staleCount: number;
}

export interface RevenueSummary {
  ytdScheduled: number;
  ytdCollected: number;
  collectionRate: number;
  pastDueTotal: number;
  overdue: OverdueInvoice[];
  dueThisMonthTotal: number;
  dueThisMonthReceived: number;
  dueNextMonthTotal: number;
  totalArr: number;
  tierBreakdown: TierArr[];
  fullYearTarget: number;
  months: MonthBucket[];
  quarters: QuarterBucket[];
  membersByRevenue: MemberRevenue[];
  proposals: ProposalPipeline;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const STALE_PROPOSAL_DAYS = 7;
const DAY = 86_400_000;

// A proposal is settled once it is won or lost — anything else is still in play.
function isPendingProposal(status: string): boolean {
  return status !== "won" && status !== "lost";
}

export function computeRevenueSummary(
  invoices: RevenueInvoice[],
  companies: RevenueCompany[],
  proposals: RevenueProposal[],
  now: Date,
): RevenueSummary {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startNextYear = new Date(now.getFullYear() + 1, 0, 1);

  let ytdScheduled = 0;
  let ytdCollected = 0;
  let pastDueTotal = 0;
  let dueThisMonthTotal = 0;
  let dueThisMonthReceived = 0;
  let dueNextMonthTotal = 0;
  let fullYearTarget = 0;
  const overdue: OverdueInvoice[] = [];
  const monthMap = new Map<string, MonthBucket>();

  for (const inv of invoices) {
    if (inv.void) continue;
    const collected = Math.min(inv.paid, inv.amount);
    const balance = inv.amount - collected;
    const due = inv.dueOn;

    // Monthly buckets span every non-void invoice's due month.
    const key = `${due.getFullYear()}-${due.getMonth()}`;
    const bucket = monthMap.get(key);
    if (bucket) bucket.total += inv.amount;
    else
      monthMap.set(key, {
        key,
        label: `${MONTH_LABELS[due.getMonth()]} ${due.getFullYear()}`,
        year: due.getFullYear(),
        month: due.getMonth(),
        total: inv.amount,
      });

    // This calendar year's scheduled dues make up the full-year target.
    if (due >= startOfYear && due < startNextYear) fullYearTarget += inv.amount;

    // Year-to-date collection rate: dues scheduled from year-start to today.
    if (due >= startOfYear && due < startOfToday) {
      ytdScheduled += inv.amount;
      ytdCollected += collected;
    }

    // Past due — anything unpaid whose due date has passed (all-time).
    if (due < startOfToday && balance > 0) {
      pastDueTotal += balance;
      overdue.push({
        id: inv.id,
        companyName: inv.companyName,
        dueOn: due,
        balance,
      });
    }

    if (due >= startThisMonth && due < startNextMonth) {
      dueThisMonthTotal += inv.amount;
      dueThisMonthReceived += collected;
    } else if (due >= startNextMonth && due < startMonthAfter) {
      dueNextMonthTotal += inv.amount;
    }
  }

  const collectionRate =
    ytdScheduled > 0 ? Math.round((ytdCollected / ytdScheduled) * 100) : 100;

  overdue.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime());

  const months = [...monthMap.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const quarters = buildQuarters(invoices, now);

  // ── Network ARR + tier breakdown ────────────────────────────────────────────
  const members = companies.filter((c) => NETWORK_STATUSES.includes(c.status));
  const totalArr = members.reduce((t, c) => t + c.annualValue, 0);

  const tierMap = new Map<string, TierArr>();
  for (const m of members) {
    const tier = m.tier?.trim() || "Untiered";
    const row = tierMap.get(tier);
    if (row) {
      row.count += 1;
      row.arr += m.annualValue;
    } else {
      tierMap.set(tier, { tier, count: 1, arr: m.annualValue });
    }
  }
  const tierBreakdown = [...tierMap.values()].sort((a, b) => b.arr - a.arr);

  const maxArr = members.reduce((m, c) => Math.max(m, c.annualValue), 0);
  const membersByRevenue: MemberRevenue[] = members
    .slice()
    .sort((a, b) => b.annualValue - a.annualValue)
    .map((c) => ({
      name: c.name,
      tier: c.tier,
      annualValue: c.annualValue,
      pct: maxArr > 0 ? Math.round((c.annualValue / maxArr) * 100) : 0,
    }));

  // ── Proposal pipeline ───────────────────────────────────────────────────────
  let wonArr = 0;
  let pipelineValue = 0;
  let staleCount = 0;
  for (const p of proposals) {
    const amount = p.amount ?? 0;
    if (p.status === "won") wonArr += amount;
    else if (isPendingProposal(p.status)) {
      pipelineValue += amount;
      const age =
        p.lastActivityAt == null
          ? Infinity
          : (now.getTime() - p.lastActivityAt.getTime()) / DAY;
      if (age > STALE_PROPOSAL_DAYS) staleCount += 1;
    }
  }

  return {
    ytdScheduled,
    ytdCollected,
    collectionRate,
    pastDueTotal,
    overdue,
    dueThisMonthTotal,
    dueThisMonthReceived,
    dueNextMonthTotal,
    totalArr,
    tierBreakdown,
    fullYearTarget,
    months,
    quarters,
    membersByRevenue,
    proposals: {
      total: proposals.length,
      wonArr,
      pipelineValue,
      staleCount,
    },
  };
}

// Roll non-void invoices up into calendar quarters, tagging each quarter's phase
// relative to the current one (past / current / projected) so the UI can colour
// collected vs. projected revenue.
function buildQuarters(
  invoices: RevenueInvoice[],
  now: Date,
): QuarterBucket[] {
  const currentQuarter = Math.floor(now.getMonth() / 3);
  const currentYear = now.getFullYear();

  const map = new Map<
    string,
    { year: number; quarter: number; total: number; invoiceCount: number }
  >();
  for (const inv of invoices) {
    if (inv.void) continue;
    const year = inv.dueOn.getFullYear();
    const quarter = Math.floor(inv.dueOn.getMonth() / 3);
    const key = `${year}-${quarter}`;
    const row = map.get(key);
    if (row) {
      row.total += inv.amount;
      row.invoiceCount += 1;
    } else {
      map.set(key, { year, quarter, total: inv.amount, invoiceCount: 1 });
    }
  }

  return [...map.values()]
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map((q) => {
      const isPast =
        q.year < currentYear ||
        (q.year === currentYear && q.quarter < currentQuarter);
      const isCurrent = q.year === currentYear && q.quarter === currentQuarter;
      const phase: QuarterPhase = isCurrent
        ? "current"
        : isPast
          ? "past"
          : "projected";
      return {
        label: `Q${q.quarter + 1} ${q.year}`,
        total: q.total,
        invoiceCount: q.invoiceCount,
        phase,
      };
    });
}
