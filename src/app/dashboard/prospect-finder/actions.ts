"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import { NETWORK_STATUSES } from "@/lib/company-statuses";
import {
  generateProspectTargets,
  type ProspectFilters,
  type ProspectMode,
  type ProspectTarget,
} from "@/lib/prospect-finder";

// Prospect finder actions (slice 11.6). findProspects assembles the tenant's
// network context in ONE withOrg tx (RLS scopes it) and hands it to the engine,
// which uses web_search to discover NEW organisations. addProspect persists a
// chosen result as a prospect company (with its primary contact) — the only
// durable effect; the search itself is ephemeral. Both are useActionState-style
// (findProspects) / transition-called (addProspect) so failures render inline.

function readFilters(formData: FormData): ProspectFilters {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    industry: get("industry"),
    county: get("county"),
    projectType: get("projectType"),
    person: get("person"),
  };
}

export type ProspectFinderState =
  | { status: "idle" }
  | { status: "ok"; mode: ProspectMode; targets: ProspectTarget[] }
  | { status: "error"; message: string };

export async function findProspects(
  _prev: ProspectFinderState,
  formData: FormData,
): Promise<ProspectFinderState> {
  const { orgId } = await requireOrgContext();

  const mode: ProspectMode =
    String(formData.get("mode")) === "recommendations"
      ? "recommendations"
      : "targeted";
  const focusArea = String(formData.get("focusArea") ?? "").trim();
  const filters = readFilters(formData);

  const { companies, projects } = await withOrg(orgId, async (tx) => {
    const companies = await tx.company.findMany({
      where: { status: { not: "former" } },
      select: { name: true, industry: true, status: true, lookingFor: true, canOffer: true },
    });
    const projects = await tx.project.findMany({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
      select: { name: true, stage: true, type: true, county: true },
    });
    return { companies, projects };
  });

  const members = companies
    .filter((c) => NETWORK_STATUSES.includes(c.status))
    .map((c) => ({ name: c.name, industry: c.industry }));
  const needs = companies
    .filter((c) => c.lookingFor || c.canOffer)
    .map((c) => ({
      name: c.name,
      lookingFor: c.lookingFor ?? "",
      canOffer: c.canOffer ?? "",
    }));
  // Exclude EVERY current org (members, partners, and existing prospects) from
  // results so we never re-surface someone already tracked.
  const excludeOrgs = companies.map((c) => c.name);

  try {
    const targets = await generateProspectTargets({
      mode,
      focusArea,
      filters,
      members,
      needs,
      projects: projects.map((p) => ({
        name: p.name,
        stage: p.stage,
        type: p.type ?? "",
        county: p.county ?? "",
      })),
      excludeOrgs,
    });
    return { status: "ok", mode, targets };
  } catch (err) {
    console.error("prospect finder failed", err);
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not search for prospects. Try again." };
  }
}

export type AddProspectResult =
  | { status: "added"; companyId: string }
  | { status: "exists" }
  | { status: "error"; message: string };

// Persist one discovered prospect as a company (status=prospect) plus its primary
// contact. Deduped by name (case-insensitive) so re-adding is a no-op. Score maps
// to a coarse temperature (1..5 -> 20..100).
export async function addProspect(
  target: ProspectTarget,
): Promise<AddProspectResult> {
  const { orgId } = await requireOrgContext();

  const name = target.org.trim();
  if (!name) return { status: "error", message: "Missing organisation name." };

  const temperature = Math.max(1, Math.min(5, target.score)) * 20;
  const counties = target.county.trim() ? [target.county.trim()] : [];

  try {
    return await withOrg(orgId, async (tx) => {
      const existing = await tx.company.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) return { status: "exists" as const };

      const company = await tx.company.create({
        data: {
          orgId,
          name,
          status: "prospect",
          industry: target.industry.trim() || "Other",
          annualValue: "0",
          source: "Prospect Finder",
          temperature,
          website: target.website,
          counties,
          lookingFor: target.theyGet.trim() || null,
          canOffer: target.theyBring.trim() || null,
          notes: target.whyNow.trim(),
          contacts: target.contact.trim()
            ? {
                create: {
                  orgId,
                  name: target.contact.trim(),
                  title: target.title.trim() || null,
                  isPrimary: true,
                },
              }
            : undefined,
        },
        select: { id: true },
      });

      return { status: "added" as const, companyId: company.id };
    });
  } catch (err) {
    console.error("add prospect failed", err);
    return { status: "error", message: "Could not add this prospect." };
  } finally {
    revalidatePath("/dashboard/companies");
  }
}
