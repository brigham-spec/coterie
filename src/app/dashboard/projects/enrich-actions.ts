"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  coerceProposedValue,
  generateProjectEnrichment,
  type EnrichField,
  type ProjectProposal,
} from "@/lib/project-enrich";

// Project enrichment actions (companion to the batch profile synth). The Press
// & News card's "Review updates from news" runs proposeProjectUpdates for ONE
// project: it loads the project's current fields plus its saved coverage
// (cross-linked + participant-company news) withOrg-scoped from the id (RLS → a
// foreign id resolves null → refused), then asks the engine to propose field
// updates. The Anthropic call runs server-side in @/lib/project-enrich; the key
// never reaches the browser. Ephemeral: nothing is written until the operator
// applies selected proposals via applyProjectUpdates below.

// How many saved articles to feed the model. Bounded so the prompt stays tight.
const ARTICLE_TAKE = 12;

export type EnrichResult =
  | { status: "ok"; proposals: ProjectProposal[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export async function proposeProjectUpdates(projectId: string): Promise<EnrichResult> {
  const id = String(projectId ?? "").trim();
  if (!id) return { status: "error", message: "missing project" };

  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      select: {
        name: true,
        stage: true,
        county: true,
        value: true,
        units: true,
        sqft: true,
        prospectLead: true,
        description: true,
        projectLinks: { select: { companyId: true } },
      },
    });
    if (project == null) return null;

    // The project's coverage: articles cross-linked to it, plus press saved
    // across its participant companies — the same pool the Press & News card
    // shows. Off-network participants carry no company, so filter nulls.
    const companyIds = project.projectLinks
      .map((l) => l.companyId)
      .filter((cid): cid is string => cid !== null);
    const articles = await tx.newsItem.findMany({
      where: {
        OR: [
          { projectId: id },
          ...(companyIds.length === 0 ? [] : [{ companyId: { in: companyIds } }]),
        ],
      },
      orderBy: { capturedAt: "desc" },
      take: ARTICLE_TAKE,
      select: { headline: true, summary: true },
    });
    return { project, articles };
  });

  if (data == null)
    return { status: "error", message: "project not found in this organization" };

  // Nothing to reason over → report empty without burning an AI call.
  if (data.articles.length === 0) return { status: "empty" };

  try {
    await enforceAiRateLimit(orgId);
    const proposals = await generateProjectEnrichment(
      {
        name: data.project.name,
        stage: data.project.stage,
        county: data.project.county ?? "",
        value: data.project.value == null ? "" : String(data.project.value),
        units: data.project.units == null ? "" : String(data.project.units),
        sqft: data.project.sqft == null ? "" : String(data.project.sqft),
        prospectLead: data.project.prospectLead ?? "",
        description: data.project.description ?? "",
      },
      data.articles.map((a) => ({ headline: a.headline, summary: a.summary ?? "" })),
    );
    if (proposals.length === 0) return { status: "empty" };
    return { status: "ok", proposals };
  } catch (err) {
    console.error("project enrichment failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not read the coverage. Try again." };
  }
}

// Apply the operator's selected proposals to the project row. The client posts
// ONLY the {field,value} pairs it checked; we re-validate every field against the
// same whitelist + coercion the parser used (never trusting the client), re-verify
// the project inside withOrg (RLS → a foreign id resolves null → refused), and
// write only the provided values. A stage change appends to stage_history so the
// timeline stays accurate (mirrors updateStage).

export type ApplyEnrichResult =
  | { status: "applied"; count: number }
  | { status: "error"; message: string };

// PURE: coerce the client's selection into a clean map of validated writes,
// running each value through the same kind-driven coercer the AI parser uses
// (coerceProposedValue) so the write boundary can never trust more than the
// parse boundary. An unknown field, out-of-vocabulary stage, or empty value is
// dropped; the first value wins if a field repeats.
function readSelection(raw: unknown): Partial<Record<EnrichField, string>> {
  if (!Array.isArray(raw)) return {};
  const out: Partial<Record<EnrichField, string>> = {};
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const field = String(obj.field ?? "").trim() as EnrichField;
    if (field in out) continue;
    const value = coerceProposedValue(field, obj.value);
    if (value === "") continue;
    out[field] = value;
  }
  return out;
}

export async function applyProjectUpdates(
  projectId: string,
  rawSelection: unknown,
): Promise<ApplyEnrichResult> {
  const id = String(projectId ?? "").trim();
  if (!id) return { status: "error", message: "missing project" };

  const selection = readSelection(rawSelection);
  const count = Object.keys(selection).length;
  if (count === 0) return { status: "error", message: "Nothing selected to apply." };

  const { orgId } = await requireOrgContext();

  const applied = await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      select: { stage: true, stageHistory: true },
    });
    if (project == null) return false;

    const data: Prisma.ProjectUpdateInput = {};
    if (selection.county !== undefined) data.county = selection.county;
    if (selection.value !== undefined) data.value = selection.value;
    if (selection.units !== undefined) data.units = Number(selection.units);
    if (selection.sqft !== undefined) data.sqft = Number(selection.sqft);
    if (selection.prospectLead !== undefined)
      data.prospectLead = selection.prospectLead;
    if (selection.description !== undefined)
      data.description = selection.description;

    // A real stage change records a stage-history entry, matching updateStage so
    // the timeline reflects the enrichment.
    if (selection.stage !== undefined && selection.stage !== project.stage) {
      const history = Array.isArray(project.stageHistory) ? project.stageHistory : [];
      data.stage = selection.stage;
      data.stageHistory = [
        ...history,
        {
          stage: selection.stage,
          date: new Date().toISOString().slice(0, 10),
          ts: Date.now(),
        },
      ];
    }

    await tx.project.update({ where: { id }, data });
    return true;
  });

  if (!applied)
    return { status: "error", message: "project not found in this organization" };

  revalidatePath(`/dashboard/projects/${id}`);
  revalidatePath("/dashboard/projects");
  return { status: "applied", count };
}
