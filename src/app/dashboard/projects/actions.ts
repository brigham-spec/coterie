"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

// Projects and their company participants (build item 4). org_id is stamped from
// context on every write (RLS WITH CHECK backstops it).

export async function createProject(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const targetDateRaw = String(formData.get("targetDate") ?? "").trim();
  const valueRaw = String(formData.get("value") ?? "").trim();

  if (!name || !stage) throw new Error("name and stage are required");
  if (valueRaw !== "" && Number.isNaN(Number(valueRaw)))
    throw new Error("value must be a number");

  await withOrg(orgId, (tx) =>
    tx.project.create({
      data: {
        orgId,
        name,
        stage,
        description,
        targetDate: targetDateRaw === "" ? null : new Date(targetDateRaw),
        value: valueRaw === "" ? null : valueRaw,
      },
    }),
  );

  revalidatePath("/dashboard/projects");
}

// Link a company to a project. Unlike contacts.company_id, project_links carries
// composite FKs — (org_id, project_id) -> projects(org_id, id) and
// (org_id, company_id) -> companies(org_id, id) — so a cross-org project or
// company id has no matching parent and the insert is refused BY THE DATABASE.
// We still stamp org_id from context; the composite FKs are the structural guard.
export async function linkCompany(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!projectId || !companyId || !role)
    throw new Error("project, company, and role are required");

  await withOrg(orgId, (tx) =>
    tx.projectLink.create({ data: { orgId, projectId, companyId, role } }),
  );

  revalidatePath(`/dashboard/projects/${projectId}`);
}
