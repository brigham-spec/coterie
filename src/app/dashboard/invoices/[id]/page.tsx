import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
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

import { recordPayment, voidInvoice } from "../actions";

// Invoice detail — the seat of payment history (build item 7, spec §3.12/§3.13).
// Invoice, company, and payments are read in one withOrg pass; the live status
// and balance are DERIVED from the payments, never stored. Payments record money
// actually received; voiding marks a bill that was never owed.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const invoice = await withOrg(ctx.orgId, (tx) =>
    tx.invoice.findUnique({
      where: { id },
      include: {
        company: { select: { name: true } },
        payments: { orderBy: { receivedOn: "desc" } },
      },
    }),
  );

  if (invoice == null) notFound();

  const paid = sumPayments(invoice.payments);
  const { status, balance } = deriveInvoiceBalance(
    invoice.status,
    invoice.amount,
    paid,
  );
  const settled = status === "paid" || status === "void";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/invoices"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Invoices
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle
            title={invoice.invoiceNumber}
            subtitle={invoice.company.name}
          />
          <StatusBadge status={status} />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Details"
          action={
            status === "void" ? null : (
              <form action={voidInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <Button type="submit">Void</Button>
              </form>
            )
          }
        />
        <dl className="grid grid-cols-4 gap-4 p-4 text-xs">
          <Detail label="Amount" value={currency.format(Number(invoice.amount))} />
          <Detail label="Collected" value={currency.format(Number(paid))} />
          <Detail label="Balance" value={currency.format(Number(balance))} />
          <Detail label="Due" value={dateFmt.format(invoice.dueOn)} />
          <Detail label="Issued" value={dateFmt.format(invoice.issuedOn)} />
          {invoice.notes !== "" ? (
            <div className="col-span-3">
              <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                Notes
              </dt>
              <dd className="text-ink">{invoice.notes}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Payments" />
        {invoice.payments.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No payments recorded yet.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Received</Th>
                <Th>Amount</Th>
                <Th>Method</Th>
              </>
            }
          >
            {invoice.payments.map((p) => (
              <Tr key={p.id}>
                <Td>{dateFmt.format(p.receivedOn)}</Td>
                <Td className="font-medium">
                  {currency.format(Number(p.amount))}
                </Td>
                <Td className="capitalize">{p.method ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {settled ? null : (
        <Card>
          <CardHeader title="Record a payment" />
          <form action={recordPayment} className="grid grid-cols-3 gap-4 p-4">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <Field
              name="amount"
              label="Amount (USD)"
              placeholder="0.00"
              inputMode="decimal"
              required
            />
            <Field name="receivedOn" label="Received on" type="date" required />
            <SelectField name="method" label="Method" defaultValue="">
              <option value="">Unspecified</option>
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="card">Card</option>
            </SelectField>
            <div className="col-span-3 flex justify-end">
              <Button type="submit" variant="primary">
                Record payment
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
        {label}
      </dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
