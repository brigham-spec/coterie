"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Button,
  Field,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { DerivedInvoiceStatus } from "@/lib/invoice-status";

import { createInvoice } from "../../invoices/actions";

// Invoice schedule on the company profile — a per-company view of the billing
// ledger the org-level Invoices module owns. Lists this member's invoices with
// their live status + balance (both derived from payments on the server) and
// folds in an "Add invoice" form that reuses the shared createInvoice action
// (companyId pinned to this company). Each row links to the invoice detail page,
// where payments are recorded and invoices are voided. View-only totals sit at
// the foot. Only rendered when the org has the invoices module enabled.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// dueOn/issuedOn are @db.Date at UTC midnight — pin the formatter to UTC so the
// day matches the invoices ledger and detail pages (review M3).
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type CompanyInvoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  balance: number;
  status: DerivedInvoiceStatus;
  dueOn: Date;
};

export function InvoicesCard({
  companyId,
  invoices,
}: {
  companyId: string;
  invoices: CompanyInvoice[];
}) {
  const [adding, setAdding] = useState(false);

  // Void invoices were never owed — leave them out of the rolled-up money.
  const live = invoices.filter((i) => i.status !== "void");
  const billed = live.reduce((t, i) => t + i.amount, 0);
  const outstanding = live.reduce((t, i) => t + i.balance, 0);

  return (
    <CollapsibleCard
      id="company-invoices"
      title="Invoice schedule"
      action={
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          {adding ? "Close" : "Add invoice"}
        </button>
      }
    >
      {adding ? (
        <div className="border-b border-line p-4">
          <AddInvoiceForm companyId={companyId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No invoices yet. Add one to start this member&apos;s payment schedule.
        </p>
      ) : (
        <>
          <Table
            head={
              <>
                <Th>Invoice</Th>
                <Th>Amount</Th>
                <Th>Balance</Th>
                <Th>Status</Th>
                <Th>Due</Th>
              </>
            }
          >
            {invoices.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-medium">
                  <Link
                    href={`/dashboard/invoices/${inv.id}`}
                    className="hover:text-gold hover:underline"
                  >
                    {inv.invoiceNumber}
                  </Link>
                </Td>
                <Td>{currency.format(inv.amount)}</Td>
                <Td>{currency.format(inv.balance)}</Td>
                <Td>
                  <StatusBadge status={inv.status} />
                </Td>
                <Td>{dateFmt.format(inv.dueOn)}</Td>
              </Tr>
            ))}
          </Table>
          <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-xs">
            <div>
              <span className="text-ink-3">Billed </span>
              <span className="font-medium text-ink">
                {currency.format(billed)}
              </span>
            </div>
            <div>
              <span className="text-ink-3">Outstanding </span>
              <span className="font-medium text-ink">
                {currency.format(outstanding)}
              </span>
            </div>
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

function AddInvoiceForm({
  companyId,
  onDone,
}: {
  companyId: string;
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await createInvoice(fd);
        onDone();
      }}
      className="grid grid-cols-2 gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <Field
        name="invoiceNumber"
        label="Invoice number"
        placeholder="INV-0001"
        required
      />
      <Field
        name="amount"
        label="Amount (USD)"
        placeholder="0.00"
        inputMode="decimal"
        required
      />
      <Field name="issuedOn" label="Issued on" type="date" required />
      <Field name="dueOn" label="Due on" type="date" required />
      <SelectField name="status" label="Status" defaultValue="draft">
        <option value="draft">Draft</option>
        <option value="sent">Sent</option>
      </SelectField>
      <Field
        name="notes"
        label="Notes (optional)"
        placeholder="Membership dues, Q3"
        className="col-span-2"
      />
      <div className="col-span-2 flex justify-end">
        <Button type="submit" variant="primary">
          Add invoice
        </Button>
      </div>
    </form>
  );
}
