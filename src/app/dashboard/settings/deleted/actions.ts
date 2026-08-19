"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { restoreDeletedRecord } from "@/lib/soft-delete";

// Recover a trashed company/contact: replay its snapshot back into the live
// tables (original ids preserved) and drop the deleted_records row. Admin-only.
// restoreDeletedRecord runs inside withOrg so RLS scopes it to the tenant — a
// foreign deletedRecordId resolves to null and the restore is refused.
export async function restoreRecord(formData: FormData): Promise<void> {
  const { orgId } = await requireAdmin();

  const deletedRecordId = String(formData.get("deletedRecordId") ?? "").trim();
  if (!deletedRecordId) throw new Error("missing record");

  const ok = await withOrg(orgId, (tx) => restoreDeletedRecord(tx, deletedRecordId));
  if (!ok) throw new Error("record not found in this organization");

  // The recover re-inserts a company/contact subgraph, so bust the surfaces
  // those rows appear on.
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings/deleted");
}
