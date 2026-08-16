import { describe, expect, test } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  buildInvoiceGrid,
  MONTH_LABELS,
  type GridInvoice,
} from "@/lib/invoice-grid";
import type { DerivedInvoiceStatus } from "@/lib/invoice-status";

// Pure tests for the Invoice Schedule grid (Dashboard 7). Places invoices in the
// month-by-company matrix by their UTC dueOn, buckets by year, rolls a cell's
// status up (overdue dominates), and totals the columns/rows. "today" is fixed so
// the past-due check is deterministic.

const dec = (n: string) => new Prisma.Decimal(n);
const today = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15

// dueOn is a @db.Date at UTC midnight.
function inv(over: Partial<GridInvoice> & { dueOn: Date }): GridInvoice {
  return {
    companyId: over.companyId ?? "a",
    companyName: over.companyName ?? "Acme",
    amount: over.amount ?? dec("1000"),
    status: (over.status ?? "sent") as DerivedInvoiceStatus,
    dueOn: over.dueOn,
  };
}

describe("buildInvoiceGrid", () => {
  test("places an invoice in its UTC due-month cell and leaves the rest empty", () => {
    const grid = buildInvoiceGrid(
      [inv({ dueOn: new Date(Date.UTC(2026, 7, 1)), amount: dec("500") })], // August
      2026,
      today,
    );
    expect(grid.rows).toHaveLength(1);
    const cells = grid.rows[0].cells;
    expect(cells).toHaveLength(MONTH_LABELS.length);
    expect(Number(cells[7].amount)).toBe(500);
    expect(cells[7].status).toBe("open"); // future relative to June 15
    expect(cells[7].count).toBe(1);
    expect(cells.filter((c) => c.status !== null)).toHaveLength(1);
  });

  test("only buckets invoices whose dueOn falls in the requested year", () => {
    const grid = buildInvoiceGrid(
      [
        inv({ dueOn: new Date(Date.UTC(2026, 0, 10)) }),
        inv({ dueOn: new Date(Date.UTC(2025, 0, 10)) }),
      ],
      2026,
      today,
    );
    expect(Number(grid.rows[0].total)).toBe(1000); // only the 2026 one
  });

  test("a past-due unpaid invoice is overdue; a paid one is paid", () => {
    const grid = buildInvoiceGrid(
      [
        inv({ dueOn: new Date(Date.UTC(2026, 0, 1)), status: "sent" }), // Jan, past due
        inv({ dueOn: new Date(Date.UTC(2026, 1, 1)), status: "paid" }), // Feb, settled
      ],
      2026,
      today,
    );
    expect(grid.rows[0].cells[0].status).toBe("overdue");
    expect(grid.rows[0].cells[1].status).toBe("paid");
  });

  test("a due date equal to today is open, not yet overdue (strict boundary)", () => {
    const grid = buildInvoiceGrid(
      [inv({ dueOn: new Date(Date.UTC(2026, 5, 15)), status: "sent" })], // June 15 == today
      2026,
      today,
    );
    expect(grid.rows[0].cells[5].status).toBe("open");
  });

  test("open dominates paid when a month mixes them with nothing overdue", () => {
    const grid = buildInvoiceGrid(
      [
        inv({ dueOn: new Date(Date.UTC(2026, 8, 5)), status: "paid" }), // Sep, settled
        inv({ dueOn: new Date(Date.UTC(2026, 8, 25)), status: "sent" }), // Sep, future/open
      ],
      2026,
      today,
    );
    expect(grid.rows[0].cells[8].status).toBe("open");
  });

  test("overdue dominates when a month mixes a late and a settled invoice", () => {
    const grid = buildInvoiceGrid(
      [
        inv({ dueOn: new Date(Date.UTC(2026, 0, 5)), status: "paid", amount: dec("300") }),
        inv({ dueOn: new Date(Date.UTC(2026, 0, 20)), status: "partial", amount: dec("200") }),
      ],
      2026,
      today,
    );
    const jan = grid.rows[0].cells[0];
    expect(jan.status).toBe("overdue");
    expect(Number(jan.amount)).toBe(500);
    expect(jan.count).toBe(2);
  });

  test("sorts rows by company name and totals columns + grand total", () => {
    const grid = buildInvoiceGrid(
      [
        inv({ companyId: "z", companyName: "Zenith", dueOn: new Date(Date.UTC(2026, 0, 1)), amount: dec("100") }),
        inv({ companyId: "a", companyName: "Acme", dueOn: new Date(Date.UTC(2026, 0, 1)), amount: dec("400") }),
      ],
      2026,
      today,
    );
    expect(grid.rows.map((r) => r.companyName)).toEqual(["Acme", "Zenith"]);
    expect(Number(grid.monthTotals[0])).toBe(500); // both due in January
    expect(Number(grid.total)).toBe(500);
  });

  test("omits a company with no invoice in the year and yields empty rows", () => {
    const grid = buildInvoiceGrid([], 2026, today);
    expect(grid.rows).toEqual([]);
    expect(Number(grid.total)).toBe(0);
    expect(grid.monthTotals.every((t) => Number(t) === 0)).toBe(true);
  });
});
