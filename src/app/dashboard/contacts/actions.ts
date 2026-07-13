"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { optionalUrl } from "@/lib/form-fields";
import { CONTACT_TAGS } from "@/lib/tags";

// Contact mutations for the tenant's companies. org_id is stamped from context
// (RLS WITH CHECK backstops it). contacts.company_id is a plain FK on
// companies.id — the composite (id, org_id) guard the junctions use isn't here —
// and FK checks bypass RLS, so a crafted company_id from another org would
// otherwise satisfy referential integrity. We close that at the app layer:
// every write looks the parent company (create) or the contact itself
// (update/remove/set-primary) up INSIDE the same withOrg tx, where RLS scopes it
// to our org — a foreign id resolves to null and the write is refused. These
// power the contacts page create form and the richer editor on the company
// profile; both revalidate the affected surfaces.

const CONTACT_TAG_KEYS = new Set(CONTACT_TAGS.map((t) => t.key));

function optionalText(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

// Checkbox group → only known contact-tag keys survive.
function readContactTags(formData: FormData): string[] {
  return formData
    .getAll("tags")
    .map((t) => String(t))
    .filter((t) => CONTACT_TAG_KEYS.has(t));
}

function revalidateContact(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/contacts");
}

export async function createContact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

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
        title: optionalText(formData, "title"),
        email: optionalText(formData, "email"),
        phone: optionalText(formData, "phone"),
        linkedin: optionalUrl(formData, "linkedin"),
        notes: String(formData.get("notes") ?? "").trim(),
        tags: readContactTags(formData),
      },
    });
  });

  revalidateContact(companyId);
}

export async function updateContact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const contactId = String(formData.get("contactId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!contactId) throw new Error("missing contact");
  if (!name) throw new Error("name is required");

  const companyId = await withOrg(orgId, async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { companyId: true },
    });
    if (contact == null) return null;

    await tx.contact.update({
      where: { id: contactId },
      data: {
        name,
        title: optionalText(formData, "title"),
        email: optionalText(formData, "email"),
        phone: optionalText(formData, "phone"),
        linkedin: optionalUrl(formData, "linkedin"),
        notes: String(formData.get("notes") ?? "").trim(),
        tags: readContactTags(formData),
      },
    });
    return contact.companyId;
  });

  if (companyId == null) throw new Error("contact not found in this organization");
  revalidateContact(companyId);
}

export async function removeContact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const contactId = String(formData.get("contactId") ?? "").trim();
  if (!contactId) throw new Error("missing contact");

  const companyId = await withOrg(orgId, async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { companyId: true },
    });
    if (contact == null) return null;
    await tx.contact.delete({ where: { id: contactId } });
    return contact.companyId;
  });

  if (companyId == null) throw new Error("contact not found in this organization");
  revalidateContact(companyId);
}

// Promote one contact to primary, demoting the firm's other contacts in the
// same tx so a company always has at most one primary.
export async function setPrimaryContact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const contactId = String(formData.get("contactId") ?? "").trim();
  if (!contactId) throw new Error("missing contact");

  const companyId = await withOrg(orgId, async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      select: { companyId: true },
    });
    if (contact == null) return null;

    await tx.contact.updateMany({
      where: { companyId: contact.companyId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.contact.update({
      where: { id: contactId },
      data: { isPrimary: true },
    });
    return contact.companyId;
  });

  if (companyId == null) throw new Error("contact not found in this organization");
  revalidateContact(companyId);
}
