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
  const type = String(formData.get("type") ?? "").trim();
  const county = String(formData.get("county") ?? "").trim();
  const unitsRaw = String(formData.get("units") ?? "").trim();
  const targetDateRaw = String(formData.get("targetDate") ?? "").trim();
  const valueRaw = String(formData.get("value") ?? "").trim();

  if (!name || !stage) throw new Error("name and stage are required");
  if (valueRaw !== "" && Number.isNaN(Number(valueRaw)))
    throw new Error("value must be a number");
  if (unitsRaw !== "" && !Number.isInteger(Number(unitsRaw)))
    throw new Error("units must be a whole number");

  await withOrg(orgId, (tx) =>
    tx.project.create({
      data: {
        orgId,
        name,
        stage,
        description,
        type: type === "" ? null : type,
        county: county === "" ? null : county,
        units: unitsRaw === "" ? null : Number(unitsRaw),
        targetDate: targetDateRaw === "" ? null : new Date(targetDateRaw),
        value: valueRaw === "" ? null : valueRaw,
      },
    }),
  );

  revalidatePath("/dashboard/projects");
}

// Advance (or correct) a project's pipeline stage. The stage change is recorded
// in stage_history alongside the write so the funnel keeps its trail — the same
// JSON the board vocabulary was recovered from. The findUnique runs inside withOrg
// (RLS-scoped), so a foreign projectId resolves to null and is refused; the
// subsequent update is likewise scoped, needing no separate ownership re-check.
export async function updateStage(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  if (!projectId || !stage) throw new Error("project and stage are required");

  await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { stage: true, stageHistory: true },
    });
    if (!project) throw new Error("project not found");
    if (project.stage === stage) return;

    const history = Array.isArray(project.stageHistory)
      ? project.stageHistory
      : [];
    const entry = {
      stage,
      date: new Date().toISOString().slice(0, 10),
      ts: Date.now(),
    };

    await tx.project.update({
      where: { id: projectId },
      data: { stage, stageHistory: [...history, entry] },
    });
  });

  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${projectId}`);
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
