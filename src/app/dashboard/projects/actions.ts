"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { getDiscipline, companyMatchesDiscipline } from "@/lib/disciplines";
import { prioritizeCandidates, type IntroCompanyProfile } from "@/lib/intro-engine";
import { introProfileInclude, toIntroProfile } from "@/lib/intro-profile";
import {
  generateRoleCandidates,
  type RoleCandidate,
} from "@/lib/open-roles-engine";
import { isProjectStage } from "@/lib/project-stages";

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
  if (!isProjectStage(stage)) throw new Error("invalid project stage");
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
  if (!isProjectStage(stage)) throw new Error("invalid project stage");

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

// Open-role scan (slice 11.4c, ported from the prototype's doOpenRolesScan) — the
// introduction engine's third mode, staffing one unfilled discipline on one
// project. In ONE withOrg tx (RLS-scoped to this tenant) it loads the project plus
// the whole network, drops companies already on the project, and seeds a candidate
// pool with those whose signals plausibly indicate the discipline (falling back to
// the full pool if the keyword filter finds none, like the prototype). The engine
// then ranks the strongest few. Like the other AI features it's a useActionState
// action returning state (not throwing) so failures render inline; results are
// EPHEMERAL — nothing is stored.

const MAX_ROLE_CANDIDATES = 30;

export type OpenRoleScanState =
  | { status: "idle" }
  | {
      status: "ok";
      role: string;
      roleLabel: string;
      candidates: RoleCandidate[];
    }
  | { status: "error"; message: string };

// The free-text a company exposes for discipline keyword-matching.
function disciplineSignals(p: IntroCompanyProfile): string {
  return [
    p.name,
    p.industry ?? "",
    p.canOffer ?? "",
    p.networkTags.join(" "),
    p.primaryContact?.title ?? "",
  ].join(" ");
}

export async function scanOpenRole(
  _prev: OpenRoleScanState,
  formData: FormData,
): Promise<OpenRoleScanState> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const roleValue = String(formData.get("role") ?? "").trim();
  const discipline = getDiscipline(roleValue);
  if (!projectId || !discipline)
    return { status: "error", message: "Pick a project and an open role." };

  const data = await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        stage: true,
        type: true,
        county: true,
        units: true,
        value: true,
        description: true,
        projectLinks: { select: { companyId: true } },
      },
    });
    if (!project) return null;
    const companies = await tx.company.findMany({ include: introProfileInclude });
    return { project, companies };
  });

  if (data === null) return { status: "error", message: "Project not found." };

  const onProject = new Set(data.project.projectLinks.map((l) => l.companyId));
  const eligible = data.companies
    .filter((c) => !onProject.has(c.id))
    .map(toIntroProfile);

  // Prefer companies whose signals match the discipline; fall back to the whole
  // eligible pool if the keyword filter finds none (prototype behavior).
  const matched = eligible.filter((p) =>
    companyMatchesDiscipline(discipline, disciplineSignals(p)),
  );
  const pool = prioritizeCandidates(
    matched.length > 0 ? matched : eligible,
    MAX_ROLE_CANDIDATES,
  );

  try {
    await enforceAiRateLimit(orgId);
    const candidates = await generateRoleCandidates(
      {
        name: data.project.name,
        stage: data.project.stage,
        type: data.project.type,
        county: data.project.county,
        units: data.project.units,
        value: data.project.value == null ? null : String(data.project.value),
        description: data.project.description,
      },
      discipline,
      pool,
    );
    return {
      status: "ok",
      role: discipline.value,
      roleLabel: discipline.label,
      candidates,
    };
  } catch (err) {
    console.error("open-role scan failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not scan for candidates. Try again." };
  }
}
