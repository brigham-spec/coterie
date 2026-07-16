"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { isCompanyStatus } from "@/lib/company-statuses";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";

// Create a company in the caller's tenant. org_id is stamped from the resolved
// context, never from client input — RLS's WITH CHECK backstops that on write.

export async function createCompany(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const annualValueRaw = String(formData.get("annualValue") ?? "").trim();

  if (!name || !status || !industry)
    throw new Error("name, status, and industry are required");
  // status is a closed vocabulary; reject anything the client shouldn't send.
  if (!isCompanyStatus(status)) throw new Error("invalid company status");

  const annualValue = annualValueRaw === "" ? "0" : annualValueRaw;
  if (Number.isNaN(Number(annualValue)) || Number(annualValue) < 0)
    throw new Error("annualValue must be a non-negative number");

  await withOrg(orgId, async (tx) => {
    const company = await tx.company.create({
      data: { orgId, name, status, industry, annualValue },
    });
    // Seed the status history with the founding status (from: null) so the
    // profile timeline has a lifecycle row from day one, mirroring the entry
    // changeCompanyStatus writes on every later transition.
    await tx.activity.create({
      data: {
        orgId,
        companyId: company.id,
        actorUserId: userId,
        type: ACTIVITY_STATUS_CHANGED,
        payload: { from: null, to: status },
        occurredAt: new Date(),
      },
    });
  });

  revalidatePath("/dashboard/companies");
}
