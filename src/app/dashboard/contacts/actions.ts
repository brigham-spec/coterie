"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

// Create a contact under one of the tenant's companies. org_id is stamped from
// context (RLS WITH CHECK backstops it). contacts.company_id is a plain FK on
// companies.id — the composite (id, org_id) guard the junctions use isn't here —
// and FK checks bypass RLS, so a crafted company_id from another org would
// otherwise satisfy referential integrity. We close that at the app layer:
// look the company up INSIDE the same withOrg tx (RLS scopes it to our org), so
// a foreign id resolves to null and the create is refused. (is_primary/notes are
// deferred to a later edit surface — not part of the create form yet.)

export async function createContact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!companyId) throw new Error("company is required");
  if (!name) throw new Error("name is required");

  await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error("company not found in this organization");

    await tx.contact.create({
      data: {
        orgId,
        companyId,
        name,
        title: title || null,
        email: email || null,
        phone: phone || null,
      },
    });
  });

  revalidatePath("/dashboard/contacts");
}
