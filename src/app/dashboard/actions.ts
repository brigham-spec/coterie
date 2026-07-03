"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

// Server actions for the companies slice. Every write goes through withOrg so
// app.org_id is set for RLS; org_id on the row is taken from the resolved
// context (never from client input) and RLS WITH CHECK rejects anything else.

export async function createCompany(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const annualValueRaw = String(formData.get("annualValue") ?? "").trim();

  if (!name || !status || !industry) {
    throw new Error("name, status, and industry are required");
  }
  const annualValue = annualValueRaw === "" ? "0" : annualValueRaw;
  if (Number.isNaN(Number(annualValue))) {
    throw new Error("annualValue must be a number");
  }

  await withOrg(orgId, (tx) =>
    tx.company.create({
      data: { orgId, name, status, industry, annualValue },
    }),
  );

  revalidatePath("/dashboard");
}
