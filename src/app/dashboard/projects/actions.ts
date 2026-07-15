"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { optionalDate } from "@/lib/form-fields";
import { getDiscipline, companyMatchesDiscipline } from "@/lib/disciplines";
import { prioritizeCandidates, type IntroCompanyProfile } from "@/lib/intro-engine";
import { introProfileInclude, toIntroProfile } from "@/lib/intro-profile";
import {
  generateRoleCandidates,
  type RoleCandidate,
} from "@/lib/open-roles-engine";
import { isProjectStage } from "@/lib/project-stages";
import { isTeamRole } from "@/lib/team-roles";
import { isFundingCategory, isFundingStatus } from "@/lib/funding";
import {
  generateFundingSuggestions,
  type FundingSuggestion,
} from "@/lib/funding-engine";

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
  const sqftRaw = String(formData.get("sqft") ?? "").trim();
  const prospectLead = String(formData.get("prospectLead") ?? "").trim();
  const targetDate = optionalDate(formData, "targetDate");
  const valueRaw = String(formData.get("value") ?? "").trim();

  if (!name || !stage) throw new Error("name and stage are required");
  if (!isProjectStage(stage)) throw new Error("invalid project stage");
  if (valueRaw !== "" && Number.isNaN(Number(valueRaw)))
    throw new Error("value must be a number");
  if (unitsRaw !== "" && !Number.isInteger(Number(unitsRaw)))
    throw new Error("units must be a whole number");
  if (sqftRaw !== "" && !Number.isInteger(Number(sqftRaw)))
    throw new Error("square footage must be a whole number");

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
        sqft: sqftRaw === "" ? null : Number(sqftRaw),
        prospectLead: prospectLead === "" ? null : prospectLead,
        targetDate,
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

// ── Project deliverables ────────────────────────────────────────────────────
// A deliverable is an action_item attached to a project. Its polymorphic owner
// (the existing owner-XOR CHECK) carries the direction: a staff owner = "we owe"
// the project, a network contact owner = "they owe" us back. Owners are always
// re-validated server-side against the allowed set — org staff for "we owe",
// contacts at a company on THIS project for "they owe" — so the client can never
// attach a foreign or off-project owner. Deliverables also surface on the
// commitments board (they're action_items), so both paths are revalidated.

function revalidateDeliverable(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/commitments");
}

export async function addProjectDeliverable(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();

  if (!projectId) throw new Error("project is required");
  if (!text) throw new Error("a deliverable description is required");
  if (direction !== "we_owe" && direction !== "they_owe")
    throw new Error("invalid direction");
  if (!ownerId) throw new Error("an owner is required");

  // "We owe" owners are org staff (org_memberships carries no RLS, so scope it
  // explicitly by org + user — refuses a foreign-tenant user).
  if (direction === "we_owe") {
    const member = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: ownerId } },
      select: { userId: true },
    });
    if (!member) throw new Error("owner is not a member of this organization");
  }

  await withOrg(orgId, async (tx) => {
    // RLS scopes the project to this org; a foreign id resolves to null.
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { projectLinks: { select: { companyId: true } } },
    });
    if (!project) throw new Error("project not found in this organization");

    if (direction === "they_owe") {
      // A "they owe" owner must be a contact at a company on this project.
      const companyIds = project.projectLinks.map((l) => l.companyId);
      const contact =
        companyIds.length === 0
          ? null
          : await tx.contact.findFirst({
              where: { id: ownerId, companyId: { in: companyIds } },
              select: { id: true },
            });
      if (!contact)
        throw new Error("owner must be a contact on a company linked to this project");
    }

    await tx.actionItem.create({
      data: {
        orgId,
        projectId,
        text,
        ownerUserId: direction === "we_owe" ? ownerId : null,
        ownerContactId: direction === "they_owe" ? ownerId : null,
      },
    });
  });

  revalidateDeliverable(projectId);
}

// Advance a deliverable's lifecycle. Bounded to the three valid states; RLS scopes
// the id to the org so a foreign id matches no row.
export async function updateProjectDeliverable(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !projectId) throw new Error("deliverable and project are required");
  if (!["open", "done", "dropped"].includes(status))
    throw new Error("invalid status");

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id, projectId }, data: { status } }),
  );
  revalidateDeliverable(projectId);
}

export async function deleteProjectDeliverable(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!id || !projectId) throw new Error("deliverable and project are required");

  await withOrg(orgId, (tx) =>
    tx.actionItem.deleteMany({ where: { id, projectId } }),
  );
  revalidateDeliverable(projectId);
}

// ── Professional team ───────────────────────────────────────────────────────
// A team member is an individual professional on a project (architect, attorney,
// lender, GC, …), captured as free text so off-network professionals can be
// tracked, with an OPTIONAL link to a CRM company. Every write re-verifies the
// parent project inside withOrg (RLS), so a foreign projectId is refused; the
// company link, when set, is likewise verified in-tenant (company_id is a plain
// FK whose referential check bypasses tenant scoping).

function readTeamFields(formData: FormData): {
  name: string;
  org: string;
  email: string;
} {
  return {
    name: String(formData.get("name") ?? "").trim().slice(0, 200),
    org: String(formData.get("org") ?? "").trim().slice(0, 200),
    email: String(formData.get("email") ?? "").trim().slice(0, 200),
  };
}

// Resolve the optional CRM company link, verifying it belongs to this tenant.
// Blank clears to null. Runs inside the caller's withOrg tx (RLS-scoped).
async function resolveTeamCompany(
  tx: Parameters<Parameters<typeof withOrg>[1]>[0],
  companyId: string,
): Promise<string | null> {
  if (companyId === "") return null;
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new Error("linked company not found in this organization");
  return company.id;
}

export async function addTeamMember(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const { name, org, email } = readTeamFields(formData);

  if (!projectId) throw new Error("project is required");
  if (!isTeamRole(role)) throw new Error("invalid team role");
  if (!name && !org) throw new Error("a name or organization is required");

  await withOrg(orgId, async (tx) => {
    // RLS scopes the project to this org; a foreign id resolves to null.
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("project not found in this organization");

    const linkedCompanyId = await resolveTeamCompany(tx, companyId);

    await tx.projectTeamMember.create({
      data: { orgId, projectId, role, name, org, email, companyId: linkedCompanyId },
    });
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateTeamMember(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const memberId = String(formData.get("memberId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const { name, org, email } = readTeamFields(formData);

  if (!memberId || !projectId) throw new Error("team member and project are required");
  if (!isTeamRole(role)) throw new Error("invalid team role");
  if (!name && !org) throw new Error("a name or organization is required");

  await withOrg(orgId, async (tx) => {
    // RLS scopes the load to this org; a foreign member id resolves to null.
    const existing = await tx.projectTeamMember.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!existing) throw new Error("team member not found in this organization");

    const linkedCompanyId = await resolveTeamCompany(tx, companyId);

    await tx.projectTeamMember.update({
      where: { id: memberId },
      data: { role, name, org, email, companyId: linkedCompanyId },
    });
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function removeTeamMember(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const memberId = String(formData.get("memberId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!memberId || !projectId) throw new Error("team member and project are required");

  await withOrg(orgId, (tx) =>
    tx.projectTeamMember.deleteMany({ where: { id: memberId, projectId } }),
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

// ── Funding Sources & Grants (projects-module parity, ported from the prototype's
// Funding Sources & Grants section) ──────────────────────────────────────────
// The state/federal/alternative capital programs a project is pursuing. Rows are
// added manually or promoted ("tracked") from an AI suggestion. Every write
// re-verifies the parent project (create) or the row itself (update/delete)
// inside withOrg — a foreign id resolves null under RLS and the write is refused.
// `suggestFundingSources` is the AI seam (useActionState; ephemeral); everything
// else is a persisted void/throw action.

function revalidateFunding(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`);
}

// Read the shared funding fields, normalizing category/status to the vocabulary
// (an out-of-vocab value falls back to the common default rather than throwing —
// the selects only ever emit valid values; this guards forged posts).
function readFundingFields(formData: FormData): {
  name: string;
  agency: string;
  category: string;
  estimatedBenefit: string;
  status: string;
  rationale: string;
  action: string;
  notes: string;
} {
  const str = (key: string, max: number) =>
    String(formData.get(key) ?? "").trim().slice(0, max);
  const categoryRaw = str("category", 40);
  const statusRaw = str("status", 40);
  return {
    name: str("name", 200),
    agency: str("agency", 200),
    category: isFundingCategory(categoryRaw) ? categoryRaw : "Grant",
    estimatedBenefit: str("estimatedBenefit", 200),
    status: isFundingStatus(statusRaw) ? statusRaw : "Identified",
    rationale: str("rationale", 500),
    action: str("action", 300),
    notes: str("notes", 500),
  };
}

// Create a funding source. Used by both the manual add form and the AI "Track"
// button (which sends the suggestion's fields plus aiSuggested=true as hidden
// inputs), so one create path covers both.
export async function addFundingSource(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const fields = readFundingFields(formData);
  const aiSuggested = String(formData.get("aiSuggested") ?? "") === "true";

  if (!projectId) throw new Error("project is required");
  if (!fields.name) throw new Error("a program name is required");

  await withOrg(orgId, async (tx) => {
    // RLS scopes the project to this org; a foreign id resolves to null.
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("project not found in this organization");

    await tx.fundingSource.create({
      data: { orgId, projectId, ...fields, aiSuggested },
    });
  });

  revalidateFunding(projectId);
}

// Edit a funding source's fields. The edit form carries rationale/action as hidden
// inputs (their existing values) so an operator edit doesn't wipe AI-provided text.
export async function updateFundingSource(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const fundingSourceId = String(formData.get("fundingSourceId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const fields = readFundingFields(formData);

  if (!fundingSourceId || !projectId)
    throw new Error("funding source and project are required");
  if (!fields.name) throw new Error("a program name is required");

  await withOrg(orgId, async (tx) => {
    // RLS scopes the load to this org; a foreign id resolves to null.
    const existing = await tx.fundingSource.findUnique({
      where: { id: fundingSourceId },
      select: { id: true },
    });
    if (!existing) throw new Error("funding source not found in this organization");

    await tx.fundingSource.update({ where: { id: fundingSourceId }, data: fields });
  });

  revalidateFunding(projectId);
}

// Quick status change from the inline row select (mirrors updateProposalStatus).
export async function updateFundingStatus(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const fundingSourceId = String(formData.get("fundingSourceId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!fundingSourceId || !projectId)
    throw new Error("funding source and project are required");
  if (!isFundingStatus(status)) throw new Error("invalid funding status");

  await withOrg(orgId, async (tx) => {
    const existing = await tx.fundingSource.findUnique({
      where: { id: fundingSourceId },
      select: { id: true },
    });
    if (!existing) throw new Error("funding source not found in this organization");
    await tx.fundingSource.update({ where: { id: fundingSourceId }, data: { status } });
  });

  revalidateFunding(projectId);
}

export async function deleteFundingSource(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const fundingSourceId = String(formData.get("fundingSourceId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!fundingSourceId || !projectId)
    throw new Error("funding source and project are required");

  await withOrg(orgId, (tx) =>
    tx.fundingSource.deleteMany({ where: { id: fundingSourceId, projectId } }),
  );
  revalidateFunding(projectId);
}

export type FundingSuggestState =
  | { status: "idle" }
  | { status: "ok"; suggestions: FundingSuggestion[] }
  | { status: "error"; message: string };

// Identify the programs this project qualifies for. Like the other useActionState
// AI seams it returns state (not throwing) so a model/network failure renders
// inline; results are EPHEMERAL — the operator tracks the ones they want via
// addFundingSource. Re-verifies the project inside withOrg (RLS refuses foreign).
export async function suggestFundingSources(
  _prev: FundingSuggestState,
  formData: FormData,
): Promise<FundingSuggestState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) return { status: "error", message: "missing project" };

  const { orgId } = await requireOrgContext();

  const project = await withOrg(orgId, (tx) =>
    tx.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        type: true,
        stage: true,
        county: true,
        units: true,
        value: true,
        description: true,
      },
    }),
  );

  if (project == null)
    return { status: "error", message: "project not found in this organization" };

  try {
    await enforceAiRateLimit(orgId);
    const suggestions = await generateFundingSuggestions({
      name: project.name,
      type: project.type,
      stage: project.stage,
      county: project.county,
      industry: null,
      value: project.value == null ? null : String(project.value),
      units: project.units,
      description: project.description || null,
    });
    return { status: "ok", suggestions };
  } catch (err) {
    console.error("funding suggestion failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not identify funding programs. Try again." };
  }
}
