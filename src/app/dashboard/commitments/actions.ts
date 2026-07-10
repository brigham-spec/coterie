"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

// Commitments surface actions. A commitment is an action_item; advancing it just
// moves its status. Bounded to the three valid states; RLS scopes the id to the
// org inside withOrg, so a foreign id matches no row (updateMany → 0 rows, no
// error). Mirrors meetings/updateActionItemStatus but revalidates this surface.

export async function updateCommitment(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (id === "") throw new Error("commitment required");
  if (!["open", "done", "dropped"].includes(status))
    throw new Error("invalid status");

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id }, data: { status } }),
  );
  revalidatePath("/dashboard/commitments");
}
