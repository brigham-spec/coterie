import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { deriveInvoiceBalance, sumPayments } from "@/lib/invoice-status";
import {
  buildInvoiceGrid,
  MONTH_LABELS,
  QUARTERS,
  type CellStatus,
  type GridInvoice,
} from "@/lib/invoice-grid";
import { Button, Card, CardHeader, PageTitle, cn } from "@/components/ui";

// Invoice Schedule grid (build item 7, Dashboard 7). The billing calendar view of
// the same ledger: each company's invoices laid out by the month they're due,
// grouped into quarters, so a full year of cash flow reads at a glance. Every cell
// is DERIVED from invoices + payments (see @/lib/invoice-grid) — read-only; the
// ledger and invoice detail remain the place to create and settle bills.

// Full currency for the roll-up totals.
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Compact currency keeps the twelve month columns narrow ("$1.2K").
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Cell tone by rolled-up status — literal class strings so Tailwind's JIT keeps them.
const CELL_TONE: Record<CellStatus, string> = {
  paid: "bg-teal-bg text-teal-ink",
  overdue: "bg-amber-bg text-amber-ink",
  open: "bg-gold-bg text-gold-ink",
};

export default async function InvoiceGridPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;

  const invoices = await withOrg(ctx.orgId, (tx) =>
    tx.invoice.findMany({
      orderBy: { dueOn: "asc" },
      select: {
        companyId: true,
        amount: true,
        dueOn: true,
        status: true,
        company: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    }),
  );

  // Derive each invoice's live status, drop void bills (never owed), and shape to
  // the grid's input. The years that have any invoice drive the year picker.
  const gridInvoices: GridInvoice[] = [];
  const yearSet = new Set<number>();
  for (const inv of invoices) {
    const { status } = deriveInvoiceBalance(
      inv.status,
      inv.amount,
      sumPayments(inv.payments),
    );
    if (status === "void") continue;
    yearSet.add(inv.dueOn.getUTCFullYear());
    gridInvoices.push({
      companyId: inv.companyId,
      companyName: inv.company.name,
      amount: inv.amount,
      dueOn: inv.dueOn,
      status,
    });
  }

  const today = new Date();
  const currentYear = today.getUTCFullYear();
  yearSet.add(currentYear);
  const years = [...yearSet].sort((a, b) => b - a);

  const requested = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const year = years.includes(requested) ? requested : years[0];

  const grid = buildInvoiceGrid(gridInvoices, year, today);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6 flex items-end justify-between">
        <PageTitle
          title="Invoice schedule"
          subtitle={`${grid.rows.length} ${grid.rows.length === 1 ? "company" : "companies"} billed in ${year}`}
        />
        <Link href="/dashboard/invoices">
          <Button variant="default">Ledger view</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <Link
            key={y}
            href={`/dashboard/invoices/grid?year=${y}`}
            className={cn(
              "rounded-sm border px-3 py-1 text-xs font-medium transition-colors",
              y === year
                ? "border-gold-line bg-gold-bg text-gold-ink"
                : "border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
            )}
          >
            {y}
          </Link>
        ))}
        <Legend />
      </div>

      <Card>
        <CardHeader title={`${year} billing calendar`} />
        {grid.rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No invoices due in {year}.{" "}
            <Link href="/dashboard/invoices" className="text-gold underline">
              Create one on the ledger
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-surface-2">
                <tr>
                  <th
                    rowSpan={2}
                    className="border-b border-line px-[0.9rem] py-2 text-left text-[9.5px] font-medium tracking-[0.08em] text-ink-3 uppercase"
                  >
                    Company
                  </th>
                  {QUARTERS.map((q) => (
                    <th
                      key={q.label}
                      colSpan={q.months.length}
                      className="border-b border-l border-line-2 px-2 py-1.5 text-center text-[9.5px] font-medium tracking-[0.08em] text-ink-3 uppercase"
                    >
                      {q.label}
                    </th>
                  ))}
                  <th
                    rowSpan={2}
                    className="border-b border-l border-line-2 px-[0.9rem] py-2 text-right text-[9.5px] font-medium tracking-[0.08em] text-ink-3 uppercase"
                  >
                    Total
                  </th>
                </tr>
                <tr>
                  {MONTH_LABELS.map((label, m) => (
                    <th
                      key={label}
                      className={cn(
                        "border-b border-line px-2 py-1 text-right text-[9px] font-medium text-ink-3",
                        m % 3 === 0 && "border-l border-line-2",
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.companyId} className="hover:bg-surface-2">
                    <td className="border-b border-line px-[0.9rem] py-2 font-medium whitespace-nowrap">
                      <Link
                        href={`/dashboard/companies/${row.companyId}`}
                        className="text-ink hover:text-gold hover:underline"
                      >
                        {row.companyName}
                      </Link>
                    </td>
                    {row.cells.map((cell, m) => (
                      <td
                        key={m}
                        className={cn(
                          "border-b border-line px-2 py-2 text-right",
                          m % 3 === 0 && "border-l border-line-2",
                        )}
                      >
                        {cell.status === null ? (
                          <span className="text-ink-3">·</span>
                        ) : (
                          <span
                            title={
                              cell.count > 1
                                ? `${cell.count} invoices · ${cell.status}`
                                : cell.status
                            }
                            className={cn(
                              "inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
                              CELL_TONE[cell.status],
                            )}
                          >
                            {compact.format(Number(cell.amount))}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="border-b border-l border-line-2 px-[0.9rem] py-2 text-right font-semibold text-ink whitespace-nowrap">
                      {currency.format(Number(row.total))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2">
                  <td className="px-[0.9rem] py-2 text-[9.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                    Total
                  </td>
                  {grid.monthTotals.map((amount, m) => (
                    <td
                      key={m}
                      className={cn(
                        "px-2 py-2 text-right text-[10px] font-semibold text-ink-2",
                        m % 3 === 0 && "border-l border-line-2",
                      )}
                    >
                      {Number(amount) > 0 ? compact.format(Number(amount)) : ""}
                    </td>
                  ))}
                  <td className="border-l border-line-2 px-[0.9rem] py-2 text-right font-semibold text-ink whitespace-nowrap">
                    {currency.format(Number(grid.total))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Legend() {
  const items: Array<{ status: CellStatus; label: string }> = [
    { status: "paid", label: "Collected" },
    { status: "overdue", label: "Past due" },
    { status: "open", label: "Scheduled" },
  ];
  return (
    <div className="ml-auto flex items-center gap-3">
      {items.map((it) => (
        <span key={it.status} className="flex items-center gap-1.5 text-[10px] text-ink-3">
          <span className={cn("h-2.5 w-2.5 rounded-sm", CELL_TONE[it.status])} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
