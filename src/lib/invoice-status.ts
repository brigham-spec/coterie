import { Prisma } from "@/generated/prisma/client";

// Pure derivation of an invoice's live status + balance from its stored status
// and the payments applied to it. "paid"/"partial" are NEVER stored — computing
// them here keeps the ledger from ever drifting from the money actually received
// (schema §3.12: "partial/paid derived from payments, never a flag"). "void"
// trumps payments: a voided invoice stays void even if a payment predates it.

export type DerivedInvoiceStatus =
  | "draft"
  | "sent"
  | "partial"
  | "paid"
  | "void";

export type InvoiceBalance = {
  status: DerivedInvoiceStatus;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
};

export function sumPayments(
  payments: ReadonlyArray<{ amount: Prisma.Decimal }>,
): Prisma.Decimal {
  return payments.reduce(
    (total, p) => total.add(p.amount),
    new Prisma.Decimal(0),
  );
}

export function deriveInvoiceBalance(
  storedStatus: string,
  amount: Prisma.Decimal,
  paid: Prisma.Decimal,
): InvoiceBalance {
  const balance = amount.sub(paid);

  if (storedStatus === "void") return { status: "void", paid, balance };
  if (amount.gt(0) && paid.gte(amount)) return { status: "paid", paid, balance };
  if (paid.gt(0)) return { status: "partial", paid, balance };

  const status: DerivedInvoiceStatus = storedStatus === "sent" ? "sent" : "draft";
  return { status, paid, balance };
}
