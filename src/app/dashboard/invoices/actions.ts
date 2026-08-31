"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireOrgContext } from "@/lib/auth";
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
  // The company profile surfaces this company's invoice schedule too.
  revalidatePath(`/dashboard/companies/${companyId}`);
}

// Edit an existing invoice's terms — the amount and dates that make up a
// company's billing cadence, plus its number, status, and notes. Matches
// createInvoice's authorization (requireOrgContext, not admin) and its RLS
// re-verification: invoiceId is a PLAIN FK, so we confirm the row belongs to
// THIS org inside the tx before updating. Only a VOIDED invoice is frozen —
// paid/partial invoices stay editable on purpose (a wrong amount or date must be
// correctable after payment), and the derived status recomputes from payments.
// Stored status only ever holds draft/sent (partial/paid are DERIVED), so we
// clamp the select the same way createInvoice does. Messages are user-facing
// (rendered inline on the detail page), so they read as sentences. Returns state
// for the inline Save confirmation.
export type EditInvoiceState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

export async function editInvoice(
  _prev: EditInvoiceState,
  formData: FormData,
): Promise<EditInvoiceState> {
  const { orgId } = await requireOrgContext();

  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!invoiceId) return { status: "error", message: "An invoice is required." };
  if (!invoiceNumber)
    return { status: "error", message: "An invoice number is required." };
  if (amountRaw === "" || Number.isNaN(Number(amountRaw)) || Number(amountRaw) < 0)
    return { status: "error", message: "Amount must be a non-negative number." };

  let companyId: string;
  try {
    const issuedOn = requiredDate(formData, "issuedOn");
    const dueOn = requiredDate(formData, "dueOn");

    companyId = await withOrg(orgId, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { companyId: true, status: true },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.status === "void")
        throw new Error("A voided invoice can't be edited.");

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoiceNumber,
          amount: amountRaw,
          issuedOn,
          dueOn,
          status: status === "sent" ? "sent" : "draft",
          notes,
        },
      });
      return invoice.companyId;
    });
  } catch (err) {
    if (err != null && typeof err === "object" && (err as { code?: string }).code === "P2002")
      return { status: "error", message: "That invoice number is already in use." };
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not save the invoice.",
    };
  }

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/companies/${companyId}`);
  return { status: "saved" };
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
  const { orgId } = await requireAdmin();

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
