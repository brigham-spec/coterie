"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

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
  const issuedOnRaw = String(formData.get("issuedOn") ?? "").trim();
  const dueOnRaw = String(formData.get("dueOn") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!companyId) throw new Error("a company is required");
  if (!invoiceNumber) throw new Error("an invoice number is required");
  if (amountRaw === "" || Number.isNaN(Number(amountRaw)) || Number(amountRaw) < 0)
    throw new Error("amount must be a non-negative number");
  if (!issuedOnRaw || !dueOnRaw)
    throw new Error("issued and due dates are required");

  await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error("company not found in this organization");

    await tx.invoice.create({
      data: {
        orgId,
        companyId,
        invoiceNumber,
        amount: amountRaw,
        issuedOn: new Date(issuedOnRaw),
        dueOn: new Date(dueOnRaw),
        status: status === "sent" ? "sent" : "draft",
        notes,
      },
    });
  });

  revalidatePath("/dashboard/invoices");
}
