"use server";

import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Prisma } from "@/generated/prisma/client";

import { requireAdmin, requireOrgContext } from "@/lib/auth";
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
import { serializeProjectTypes } from "@/lib/project-types";
import { isProjectLinkRole } from "@/lib/project-roles";
import { isFundingCategory, isFundingStatus } from "@/lib/funding";
import {
  generateFundingSuggestions,
  type FundingSuggestion,
} from "@/lib/funding-engine";
import {
  normalizeGrantStatus,
  parseImpactForm,
  serializeImpactForm,
  type Grant,
} from "@/lib/value-created";
import {
  HV_SERVICE_DEFS,
  normalizeFeeStatus,
  normalizeServiceStatus,
} from "@/lib/hv-services";
import { isAssistanceKey } from "@/lib/project-assistance";

// Projects and their company participants (build item 4). org_id is stamped from
// context on every write (RLS WITH CHECK backstops it).

export async function createProject(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const type = serializeProjectTypes(formData.getAll("type").map(String));
  const industry = String(formData.get("industry") ?? "").trim();
  const county = String(formData.get("county") ?? "").trim();
  const unitsRaw = String(formData.get("units") ?? "").trim();
  const sqftRaw = String(formData.get("sqft") ?? "").trim();
  const prospectLead = String(formData.get("prospectLead") ?? "").trim();
  const developerMemberId = String(formData.get("developerMemberId") ?? "").trim();
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

  await withOrg(orgId, async (tx) => {
    // The developer link, when set, must resolve to a company in this tenant
    // (developer_member_id is a plain FK whose referential check bypasses RLS).
    const developerId = await resolveLinkedCompany(tx, developerMemberId);
    await tx.project.create({
      data: {
        orgId,
        name,
        stage,
        description,
        type: type === "" ? null : type,
        industry: industry === "" ? null : industry,
        county: county === "" ? null : county,
        units: unitsRaw === "" ? null : Number(unitsRaw),
        sqft: sqftRaw === "" ? null : Number(sqftRaw),
        prospectLead: prospectLead === "" ? null : prospectLead,
        developerMemberId: developerId,
        targetDate,
        value: valueRaw === "" ? null : valueRaw,
        // Seed the stage trail with the founding stage so the timeline has a row
        // from day one; updateStage appends to this same JSON (see below).
        stageHistory: [
          {
            stage,
            date: new Date().toISOString().slice(0, 10),
            ts: Date.now(),
          },
        ],
      },
    });
  });

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

// ── Project participants (the unified roster) ────────────────────────────────
// A participant is one company (or off-network person) on a project, in a role,
// with an optional primary contact. project_links carries composite FKs —
// (org_id, project_id) -> projects(org_id, id) and (org_id, company_id) ->
// companies(org_id, id) — so a cross-org project or company id has no matching
// parent and the insert is refused BY THE DATABASE. A company may hold multiple
// roles (rows) on one project. Off-network rows carry a null company + free-text
// name/org/email. Both link surfaces (the project page and the company profile)
// revalidate, since either can create a participant.

// Resolve an optional network company link (a participant's firm, a project's
// developer), verifying it belongs to this tenant. Blank clears to null. Runs
// inside the caller's withOrg tx (RLS-scoped, so a foreign id resolves null).
async function resolveLinkedCompany(
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

// The free-text fields for an off-network participant, trimmed and bounded.
function readParticipantFields(formData: FormData): {
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

// Resolve the optional primary contact for a participant. Null when off-network
// (no company) or unset. When set, the contact MUST belong to the participant's
// company (contact_id is a plain FK whose referential check bypasses tenant
// scoping — companyId here is already tenant-verified by resolveLinkedCompany).
async function resolveParticipantContact(
  tx: Parameters<Parameters<typeof withOrg>[1]>[0],
  companyId: string | null,
  contactId: string,
): Promise<string | null> {
  if (companyId === null || contactId === "") return null;
  const contact = await tx.contact.findFirst({
    where: { id: contactId, companyId },
    select: { id: true },
  });
  if (!contact)
    throw new Error("primary contact must be a contact at the selected company");
  return contact.id;
}

// Build the write payload shared by add/update: a company row keeps the free-text
// fields empty (company + contact carry it); an off-network row keeps them.
async function resolveParticipant(
  tx: Parameters<Parameters<typeof withOrg>[1]>[0],
  formData: FormData,
): Promise<{
  companyId: string | null;
  contactId: string | null;
  role: string;
  name: string;
  org: string;
  email: string;
}> {
  const role = String(formData.get("role") ?? "").trim();
  if (!isProjectLinkRole(role)) throw new Error("invalid role");

  const companyId = await resolveLinkedCompany(
    tx,
    String(formData.get("companyId") ?? "").trim(),
  );
  const contactId = await resolveParticipantContact(
    tx,
    companyId,
    String(formData.get("contactId") ?? "").trim(),
  );
  const fields = readParticipantFields(formData);
  if (companyId === null && !fields.name && !fields.org)
    throw new Error("select a company, or enter a name or organization");

  return {
    companyId,
    contactId,
    role,
    name: companyId ? "" : fields.name,
    org: companyId ? "" : fields.org,
    email: companyId ? "" : fields.email,
  };
}

export async function addParticipant(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("project is required");

  const companyId = await withOrg(orgId, async (tx) => {
    // RLS scopes the project to this org; a foreign id resolves to null.
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("project not found in this organization");

    const data = await resolveParticipant(tx, formData);
    await tx.projectLink.create({ data: { orgId, projectId, ...data } });
    return data.companyId;
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  if (companyId) revalidatePath(`/dashboard/companies/${companyId}`);
}

export async function updateParticipant(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const linkId = String(formData.get("linkId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!linkId || !projectId)
    throw new Error("participant and project are required");

  // The companies whose profiles need revalidating: the old link's company (if
  // any) and the new one (if any).
  const affected = new Set<string>();
  await withOrg(orgId, async (tx) => {
    // RLS scopes the load to this org; a foreign link id resolves to null.
    const existing = await tx.projectLink.findUnique({
      where: { id: linkId },
      select: { companyId: true },
    });
    if (!existing) throw new Error("participant not found in this organization");
    if (existing.companyId) affected.add(existing.companyId);

    const data = await resolveParticipant(tx, formData);
    if (data.companyId) affected.add(data.companyId);

    await tx.projectLink.update({ where: { id: linkId }, data });
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  for (const cid of affected) revalidatePath(`/dashboard/companies/${cid}`);
}

// Remove a participant. Keyed on the surrogate id (a company can hold several
// roles now); deleteMany (not delete) so an RLS-excluded row is a silent no-op.
export async function removeParticipant(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const linkId = String(formData.get("linkId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!linkId || !projectId)
    throw new Error("participant and project are required");

  const companyId = await withOrg(orgId, async (tx) => {
    const existing = await tx.projectLink.findUnique({
      where: { id: linkId },
      select: { companyId: true },
    });
    await tx.projectLink.deleteMany({ where: { id: linkId, projectId } });
    return existing?.companyId ?? null;
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  if (companyId) revalidatePath(`/dashboard/companies/${companyId}`);
}

// Permanently delete a project. All child rows cascade at the DB (project_links,
// funding_sources, action_items) or SetNull (introductions, events), so the
// single deleteMany is enough. deleteMany keeps it a no-op when RLS excludes the
// row; then redirect back to the directory.
export async function deleteProject(formData: FormData): Promise<void> {
  const { orgId } = await requireAdmin();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("project is required");

  await withOrg(orgId, (tx) =>
    tx.project.deleteMany({ where: { id: projectId } }),
  );

  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects");
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

// Re-validate a deliverable's owner against the allowed set inside the tenant tx,
// returning the owner-XOR pair for the action_item write. A "we owe" owner must be
// org staff (org_memberships carries no RLS, so scope it explicitly by org + user);
// a "they owe" owner must be a contact at a company on THIS project. The project is
// reloaded under RLS first, so a foreign or off-project owner (and a foreign project
// id) is refused. The bare-prisma membership lookup runs on its own connection, so
// it stays sequential with the tx — never concurrent on the pinned client.
async function resolveDeliverableOwner(
  tx: Prisma.TransactionClient,
  orgId: string,
  projectId: string,
  direction: "we_owe" | "they_owe",
  ownerId: string,
): Promise<{ ownerUserId: string | null; ownerContactId: string | null }> {
  // RLS scopes the project to this org; a foreign id resolves to null.
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { projectLinks: { select: { companyId: true } } },
  });
  if (!project) throw new Error("project not found in this organization");

  if (direction === "we_owe") {
    const member = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: ownerId } },
      select: { userId: true },
    });
    if (!member) throw new Error("owner is not a member of this organization");
    return { ownerUserId: ownerId, ownerContactId: null };
  }

  // A "they owe" owner must be a contact at a company on this project (off-network
  // participants carry a null company, so drop those before the contact lookup).
  const companyIds = project.projectLinks
    .map((l) => l.companyId)
    .filter((id): id is string => id !== null);
  const contact =
    companyIds.length === 0
      ? null
      : await tx.contact.findFirst({
          where: { id: ownerId, companyId: { in: companyIds } },
          select: { id: true },
        });
  if (!contact)
    throw new Error("owner must be a contact on a company linked to this project");
  return { ownerUserId: null, ownerContactId: ownerId };
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

  await withOrg(orgId, async (tx) => {
    const owner = await resolveDeliverableOwner(tx, orgId, projectId, direction, ownerId);
    await tx.actionItem.create({
      data: { orgId, projectId, text, ...owner },
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

// Manually correct a deliverable — the AI can mis-word an item or mis-attribute
// its owner, so a human fixes the description and reassigns the owner after the
// fact. The reassigned owner is re-validated exactly like addProjectDeliverable
// (via resolveDeliverableOwner) to keep the owner-XOR CHECK satisfied. RLS scopes
// the id + project to the org so a foreign deliverable matches no row.
export async function editProjectDeliverable(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();

  if (!id || !projectId) throw new Error("deliverable and project are required");
  if (!text) throw new Error("a deliverable description is required");
  if (direction !== "we_owe" && direction !== "they_owe")
    throw new Error("invalid direction");
  if (!ownerId) throw new Error("an owner is required");

  await withOrg(orgId, async (tx) => {
    const owner = await resolveDeliverableOwner(tx, orgId, projectId, direction, ownerId);
    await tx.actionItem.updateMany({
      where: { id, projectId },
      data: { text, ...owner },
    });
  });
  revalidateDeliverable(projectId);
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

  const data = await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        type: true,
        industry: true,
        stage: true,
        county: true,
        units: true,
        value: true,
        description: true,
      },
    });
    if (project == null) return null;
    // The programs already tracked on this project — fed to the model so each
    // click surfaces genuinely new options rather than re-rolling the same set.
    const tracked = await tx.fundingSource.findMany({
      where: { projectId },
      select: { name: true },
    });
    return { project, trackedNames: tracked.map((t) => t.name) };
  });

  if (data == null)
    return { status: "error", message: "project not found in this organization" };

  const { project } = data;

  try {
    await enforceAiRateLimit(orgId);
    const suggestions = await generateFundingSuggestions(
      {
        name: project.name,
        type: project.type,
        stage: project.stage,
        county: project.county,
        industry: project.industry,
        value: project.value == null ? null : String(project.value),
        units: project.units,
        description: project.description || null,
      },
      data.trackedNames,
    );
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

// ── Project profile details (projects-module parity) ─────────────────────────
// The editable profile facts a project accrues after creation: its sector
// (industry), the developer/lead — either a network company (developer_member_id) OR
// free-text (prospect_lead) — captured on the detail page. RLS scopes the update
// to this org; the developer link is re-verified in-tenant.
function readIntFromNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

// Result of the Edit-details form, surfaced inline via useActionState so the
// user gets a "Saved" confirmation without scrolling back up the page.
export type UpdateDetailsState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

export async function updateProjectDetails(
  _prev: UpdateDetailsState,
  formData: FormData,
): Promise<UpdateDetailsState> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const type = serializeProjectTypes(formData.getAll("type").map(String));
  const industry = String(formData.get("industry") ?? "").trim().slice(0, 200);
  const county = String(formData.get("county") ?? "").trim();
  const unitsRaw = String(formData.get("units") ?? "").trim();
  const sqftRaw = String(formData.get("sqft") ?? "").trim();
  const prospectLead = String(formData.get("prospectLead") ?? "").trim().slice(0, 200);
  const developerMemberId = String(formData.get("developerMemberId") ?? "").trim();
  const targetDate = optionalDate(formData, "targetDate");
  const valueRaw = String(formData.get("value") ?? "").trim();
  const realizedValueRaw = String(formData.get("realizedValue") ?? "").trim();

  if (!projectId) return { status: "error", message: "project is required" };
  if (!name) return { status: "error", message: "name is required" };
  if (valueRaw !== "" && Number.isNaN(Number(valueRaw)))
    return { status: "error", message: "value must be a number" };
  if (realizedValueRaw !== "" && Number.isNaN(Number(realizedValueRaw)))
    return { status: "error", message: "realized value must be a number" };
  if (unitsRaw !== "" && !Number.isInteger(Number(unitsRaw)))
    return { status: "error", message: "units must be a whole number" };
  if (sqftRaw !== "" && !Number.isInteger(Number(sqftRaw)))
    return { status: "error", message: "square footage must be a whole number" };

  try {
    await withOrg(orgId, async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) throw new Error("project not found in this organization");

      const developerId = await resolveLinkedCompany(tx, developerMemberId);

      await tx.project.update({
        where: { id: projectId },
        data: {
          name,
          description,
          type: type === "" ? null : type,
          industry: industry === "" ? null : industry,
          county: county === "" ? null : county,
          units: unitsRaw === "" ? null : Number(unitsRaw),
          sqft: sqftRaw === "" ? null : Number(sqftRaw),
          prospectLead: prospectLead === "" ? null : prospectLead,
          developerMemberId: developerId,
          targetDate,
          value: valueRaw === "" ? null : valueRaw,
          realizedValue: realizedValueRaw === "" ? null : realizedValueRaw,
        },
      });
    });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not save details.",
    };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
  return { status: "saved" };
}

// ── Economic impact (projects-module parity, ported from the prototype's
// "Economic Impact" section) ─────────────────────────────────────────────────
// A project's regional impact — jobs, construction cost, a tax abatement, and a
// list of state grants — stored on the economic_impact Json column. These feed
// the Value Created rollup (@/lib/value-created). Grants are their own numeric
// list here (distinct from the qualitative FundingSource table). Every write
// reads the current Json, mutates it, and writes the full object back, so the
// scalar-and-grants shape is always internally consistent. All money in dollars.
function revalidateImpact(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/value-created");
}

// Load the current impact form inside a tx (RLS-scoped), refusing a foreign id.
async function loadImpactForm(
  tx: Parameters<Parameters<typeof withOrg>[1]>[0],
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { economicImpact: true },
  });
  if (!project) throw new Error("project not found in this organization");
  return parseImpactForm(project.economicImpact);
}

// Update the scalar impact fields + tax abatement, preserving the grants list.
export async function updateEconomicImpact(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("project is required");

  const permanentJobs = readIntFromNumber(String(formData.get("permanentJobs") ?? ""));
  const constructionJobs = readIntFromNumber(String(formData.get("constructionJobs") ?? ""));
  const constructionCost = readIntFromNumber(String(formData.get("constructionCost") ?? ""));
  const taxAbatementActive = String(formData.get("taxAbatementActive") ?? "") === "on";
  const taxAbatementValue = readIntFromNumber(String(formData.get("taxAbatementValue") ?? ""));

  await withOrg(orgId, async (tx) => {
    const form = await loadImpactForm(tx, projectId);
    const next = serializeImpactForm({
      ...form,
      permanentJobs,
      constructionJobs,
      constructionCost,
      taxAbatementActive,
      taxAbatementValue,
    });
    await tx.project.update({
      where: { id: projectId },
      data: { economicImpact: next as Prisma.InputJsonValue },
    });
  });

  revalidateImpact(projectId);
}

export async function addProjectGrant(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  const amount = readIntFromNumber(String(formData.get("amount") ?? ""));
  const status = normalizeGrantStatus(String(formData.get("status") ?? "").trim());

  if (!projectId) throw new Error("project is required");
  if (!name) throw new Error("a grant program name is required");

  const grant: Grant = { id: randomUUID(), name, amount, status };

  await withOrg(orgId, async (tx) => {
    const form = await loadImpactForm(tx, projectId);
    const next = serializeImpactForm({ ...form, grants: [...form.grants, grant] });
    await tx.project.update({
      where: { id: projectId },
      data: { economicImpact: next as Prisma.InputJsonValue },
    });
  });

  revalidateImpact(projectId);
}

export async function removeProjectGrant(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  const grantId = String(formData.get("grantId") ?? "").trim();
  if (!projectId || !grantId) throw new Error("project and grant are required");

  await withOrg(orgId, async (tx) => {
    const form = await loadImpactForm(tx, projectId);
    const next = serializeImpactForm({
      ...form,
      grants: form.grants.filter((g) => g.id !== grantId),
    });
    await tx.project.update({
      where: { id: projectId },
      data: { economicImpact: next as Prisma.InputJsonValue },
    });
  });

  revalidateImpact(projectId);
}

// ── HVEDC services (projects-module parity, ported from the prototype's "HVEDC
// Services on this Project") ─────────────────────────────────────────────────
// What HVEDC is doing for a project across five service lines, each with a fee.
// Active fees flow into Revenue reporting (@/lib/hv-services sumActiveServiceFees).
// Stored on the hv_services Json column; the whole five-line object is written at
// once from the edit form. Status vocab is normalized at this write boundary.
export async function updateHvServices(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("project is required");

  const services: Record<string, unknown> = {};
  for (const def of HV_SERVICE_DEFS) {
    services[def.key] = {
      active: String(formData.get(`${def.key}_active`) ?? "") === "on",
      status: normalizeServiceStatus(String(formData.get(`${def.key}_status`) ?? "").trim()),
      description: String(formData.get(`${def.key}_description`) ?? "").trim().slice(0, 300),
      fee: readIntFromNumber(String(formData.get(`${def.key}_fee`) ?? "")),
      feeStatus: normalizeFeeStatus(String(formData.get(`${def.key}_feeStatus`) ?? "").trim()),
    };
  }

  await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("project not found in this organization");
    await tx.project.update({
      where: { id: projectId },
      data: { hvServices: services as Prisma.InputJsonValue },
    });
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/revenue");
}

// ── Assistance requested ──────────────────────────────────────────────────────
// What the project is asking the org to help with (equity sourcing, CFA, IDA
// navigation, grants, entitlements, …). An intake/needs signal stored as a flat
// list of vocabulary keys on assistance_requested. The whole set is written at
// once from the edit form; unknown keys are dropped at this write boundary.
export async function updateProjectAssistance(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("project is required");

  const selected = Array.from(
    new Set(
      formData
        .getAll("assistance")
        .map((v) => String(v).trim())
        .filter(isAssistanceKey),
    ),
  );

  await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("project not found in this organization");
    await tx.project.update({
      where: { id: projectId },
      data: { assistanceRequested: selected },
    });
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
}
