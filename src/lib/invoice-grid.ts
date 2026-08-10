import { Prisma } from "@/generated/prisma/client";

import type { DerivedInvoiceStatus } from "@/lib/invoice-status";

// PURE builder for the Invoice Schedule spreadsheet grid (build item 7, Dashboard
// 7). Ported from the prototype's month-by-member matrix: rows are companies,
// the twelve columns are the months of a chosen year (grouped into quarters), and
// each cell rolls up the invoices DUE in that month by their derived status. It
// reads the same Invoice + payment data as the ledger — nothing new is stored —
// so the grid and the ledger can never disagree.

// One invoice as the grid sees it: already derived (void excluded upstream), with
// the money owed and the due date it should land in.
export type GridInvoice = {
  companyId: string;
  companyName: string;
  amount: Prisma.Decimal;
  dueOn: Date;
  status: DerivedInvoiceStatus;
};

// A cell's rolled-up billing state. "paid" = every invoice in the bucket is
// settled; "overdue" = at least one is past its due date and unpaid; "open" =
// scheduled/sent but not yet due. null = nothing billed that month.
export type CellStatus = "paid" | "overdue" | "open";

export type GridCell = {
  amount: Prisma.Decimal;
  status: CellStatus | null;
  count: number;
};

export type GridRow = {
  companyId: string;
  companyName: string;
  cells: GridCell[]; // length 12, January → December
  total: Prisma.Decimal;
};

export type InvoiceGrid = {
  year: number;
  rows: GridRow[];
  monthTotals: Prisma.Decimal[]; // length 12
  total: Prisma.Decimal;
};

// The four calendar quarters as [label, month indices] so the header can span
// each group. Kept here (not the page) so the grid's shape is one source of truth.
export const QUARTERS: ReadonlyArray<{ label: string; months: number[] }> = [
  { label: "Q1", months: [0, 1, 2] },
  { label: "Q2", months: [3, 4, 5] },
  { label: "Q3", months: [6, 7, 8] },
  { label: "Q4", months: [9, 10, 11] },
];

export const MONTH_LABELS = [
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
] as const;

const zero = () => new Prisma.Decimal(0);

// dueOn is a @db.Date at UTC midnight, so bucket by the UTC month to match how
// the ledger and revenue pages format the same dates (review M3).
function cellStatusOf(inv: GridInvoice, today: Date): CellStatus {
  if (inv.status === "paid") return "paid";
  return inv.dueOn.getTime() < today.getTime() ? "overdue" : "open";
}

// Overdue dominates the cell (it needs attention), then open, then paid — so a
// month mixing a late bill and a settled one reads as overdue.
function rollUp(a: CellStatus, b: CellStatus): CellStatus {
  if (a === "overdue" || b === "overdue") return "overdue";
  if (a === "open" || b === "open") return "open";
  return "paid";
}

// Build the grid for one calendar year. Only invoices whose dueOn falls in `year`
// are placed; a company with none is omitted. Rows are sorted by company name.
export function buildInvoiceGrid(
  invoices: readonly GridInvoice[],
  year: number,
  today: Date,
): InvoiceGrid {
  const byCompany = new Map<string, GridRow>();

  for (const inv of invoices) {
    if (inv.dueOn.getUTCFullYear() !== year) continue;
    const month = inv.dueOn.getUTCMonth();

    let row = byCompany.get(inv.companyId);
    if (row === undefined) {
      row = {
        companyId: inv.companyId,
        companyName: inv.companyName,
        cells: MONTH_LABELS.map(() => ({ amount: zero(), status: null, count: 0 })),
        total: zero(),
      };
      byCompany.set(inv.companyId, row);
    }

    const cell = row.cells[month];
    const status = cellStatusOf(inv, today);
    cell.amount = cell.amount.add(inv.amount);
    cell.status = cell.status === null ? status : rollUp(cell.status, status);
    cell.count += 1;
    row.total = row.total.add(inv.amount);
  }

  const rows = [...byCompany.values()].sort((a, b) =>
    a.companyName.localeCompare(b.companyName),
  );

  const monthTotals = MONTH_LABELS.map((_, m) =>
    rows.reduce((t, r) => t.add(r.cells[m].amount), zero()),
  );
  const total = rows.reduce((t, r) => t.add(r.total), zero());

  return { year, rows, monthTotals, total };
}
