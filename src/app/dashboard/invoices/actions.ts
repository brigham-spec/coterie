"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { requiredDate } from "@/lib/form-fields";

// Invoices — the billing ledger (build item 7, spec §3.12). org_id is stamped
// from context; RLS WITH CHECK backstops the write. companyId is a PLAIN FK, and
// Postgres FK checks bypass RLS, so a crafted foreign id would satisfy referential
// integrity — we re-verify the company belongs to THIS org inside the same withOrg
// tx (RLS scopes the lookup → a foreign id resolves null → throw) before creating.
// invoiceNumber is unique per org (@@unique([orgId, invoiceNumber])).

export async function createInvoice(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!companyId) throw new Error("a company is required");
  if (!invoiceNumber) throw new Error("an invoice number is required");
  if (amountRaw === "" || Number.isNaN(Number(amountRaw)) || Number(amountRaw) < 0)
    throw new Error("amount must be a non-negative number");
  const issuedOn = requiredDate(formData, "issuedOn");
  const dueOn = requiredDate(formData, "dueOn");

  await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error("company not found in this organization");

    await tx.invoice.create({
      data: {
        orgId,
        companyId,
        invoiceNumber,
        amount: amountRaw,
        issuedOn,
        dueOn,
        status: status === "sent" ? "sent" : "draft",
        notes,
      },
    });
  });

  revalidatePath("/dashboard/invoices");
}

// Record money received against an invoice. invoiceId is a PLAIN FK on
// invoices.id, and Postgres FK checks bypass RLS, so we re-verify the invoice
// belongs to THIS org inside the same withOrg tx (foreign id → null → throw)
// before creating the payment. "paid"/"partial" stay derived — recording a
// payment never flips a stored status flag.
export async function recordPayment(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();

  if (!invoiceId) throw new Error("an invoice is required");
  if (amountRaw === "" || Number.isNaN(Number(amountRaw)) || Number(amountRaw) <= 0)
    throw new Error("amount must be a positive number");
  const receivedOn = requiredDate(formData, "receivedOn");

  await withOrg(orgId, async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error("invoice not found in this organization");

    await tx.payment.create({
      data: {
        orgId,
        invoiceId,
        amount: amountRaw,
        receivedOn,
        method: method === "" ? null : method,
      },
    });
  });

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
}

// Void an invoice — a bill that was never owed. updateMany is RLS-scoped, so a
// foreign id simply matches no row. "void" then trumps any payment in the
// derived status (see @/lib/invoice-status).
export async function voidInvoice(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) throw new Error("an invoice is required");

  await withOrg(orgId, (tx) =>
    tx.invoice.updateMany({
      where: { id: invoiceId },
      data: { status: "void" },
    }),
  );

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
}
