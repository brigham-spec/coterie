import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { Prisma } from "@/generated/prisma/client";
import {
  deriveInvoiceBalance,
  sumPayments,
} from "@/lib/invoice-status";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { createInvoice } from "./actions";

// Invoices — the billing ledger and revenue at a glance (build item 7, spec
// §3.12). Invoices, their payments, and the company list are read through withOrg
// in one tenant-scoped pass, so nothing foreign appears. Every row's live status
// and balance are DERIVED from its payments (see @/lib/invoice-status) — the
// stored status only ever holds draft/sent/void.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function InvoicesPage() {
  const ctx = await requireOrgContext();

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const { companies, invoices } = await withOrg(ctx.orgId, async (tx) => {
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const invoices = await tx.invoice.findMany({
      orderBy: { issuedOn: "desc" },
      include: {
        company: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    });
    return { companies, invoices };
  });

  // Derive each row's live state once, then roll the money up. Void invoices are
  // excluded from every total — they represent bills that were never owed.
  const rows = invoices.map((inv) => {
    const paid = sumPayments(inv.payments);
    return { inv, ...deriveInvoiceBalance(inv.status, inv.amount, paid) };
  });

  const zero = new Prisma.Decimal(0);
  const billed = rows.reduce(
    (t, r) => (r.status === "void" ? t : t.add(r.inv.amount)),
    zero,
  );
  const collected = rows.reduce(
    (t, r) => (r.status === "void" ? t : t.add(r.paid)),
    zero,
  );
  const outstanding = billed.sub(collected);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Invoices"
          subtitle={`${invoices.length} on ${ctx.orgName}'s ledger`}
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Kpi label="Billed" value={currency.format(Number(billed))} />
        <Kpi label="Collected" value={currency.format(Number(collected))} />
        <Kpi label="Outstanding" value={currency.format(Number(outstanding))} />
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardHeader title="Create an invoice" />
          <p className="px-4 py-6 text-xs text-ink-3">
            Add a{" "}
            <Link href="/dashboard/companies" className="text-gold underline">
              company
            </Link>{" "}
            first to bill it.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Create an invoice" />
          <form action={createInvoice} className="grid grid-cols-2 gap-4 p-4">
            <SelectField name="companyId" label="Company" defaultValue="" required>
              <option value="" disabled>
                Select a company…
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
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
            <SelectField name="status" label="Status" defaultValue="draft">
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
            </SelectField>
            <Field name="issuedOn" label="Issued on" type="date" required />
            <Field name="dueOn" label="Due on" type="date" required />
            <Field
              name="notes"
              label="Notes (optional)"
              placeholder="Membership dues, Q3"
              className="col-span-2"
            />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Create invoice
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Ledger" />
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No invoices yet.
            {companies.length > 0 ? " Create one above." : ""}
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Invoice</Th>
                <Th>Company</Th>
                <Th>Amount</Th>
                <Th>Balance</Th>
                <Th>Status</Th>
                <Th>Due</Th>
              </>
            }
          >
            {rows.map((r) => (
              <Tr key={r.inv.id}>
                <Td className="font-medium">
                  <Link
                    href={`/dashboard/invoices/${r.inv.id}`}
                    className="hover:text-gold hover:underline"
                  >
                    {r.inv.invoiceNumber}
                  </Link>
                </Td>
                <Td>{r.inv.company.name}</Td>
                <Td>{currency.format(Number(r.inv.amount))}</Td>
                <Td>{currency.format(Number(r.balance))}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>{dateFmt.format(r.inv.dueOn)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-card">
      <div className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="mt-1 font-serif text-[18px] text-ink">{value}</div>
    </div>
  );
}
