import { describe, it, expect } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  deriveInvoiceBalance,
  sumPayments,
} from "@/lib/invoice-status";

// Unit test for the derived invoice status/balance (build item 7, spec §3.12).
// Pure logic, no DB. "paid"/"partial" are computed from payments, never stored;
// "void" trumps any payment.

const dec = (n: string) => new Prisma.Decimal(n);

describe("invoice balance derivation", () => {
  it("sums payments to a Decimal total", () => {
    const total = sumPayments([{ amount: dec("100.50") }, { amount: dec("49.50") }]);
    expect(total.equals(dec("150.00"))).toBe(true);
  });

  it("keeps a stored draft/sent status when no payments applied", () => {
    const draft = deriveInvoiceBalance("draft", dec("1000"), dec("0"));
    expect(draft.status).toBe("draft");
    expect(draft.balance.equals(dec("1000"))).toBe(true);

    const sent = deriveInvoiceBalance("sent", dec("1000"), dec("0"));
    expect(sent.status).toBe("sent");
  });

  it("derives partial when some but not all is paid", () => {
    const b = deriveInvoiceBalance("sent", dec("1000"), dec("400"));
    expect(b.status).toBe("partial");
    expect(b.balance.equals(dec("600"))).toBe(true);
  });

  it("derives paid when payments cover the full amount", () => {
    const exact = deriveInvoiceBalance("sent", dec("1000"), dec("1000"));
    expect(exact.status).toBe("paid");
    expect(exact.balance.equals(dec("0"))).toBe(true);

    // Overpayment still reads as paid; balance goes negative.
    const over = deriveInvoiceBalance("sent", dec("1000"), dec("1200"));
    expect(over.status).toBe("paid");
    expect(over.balance.equals(dec("-200"))).toBe(true);
  });

  it("void trumps payments", () => {
    const b = deriveInvoiceBalance("void", dec("1000"), dec("1000"));
    expect(b.status).toBe("void");
  });

  it("a zero-amount invoice never reads as paid off nothing", () => {
    const b = deriveInvoiceBalance("draft", dec("0"), dec("0"));
    expect(b.status).toBe("draft");
  });
});
