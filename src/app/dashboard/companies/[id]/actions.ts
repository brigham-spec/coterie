"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { generateCompanyBrief } from "@/lib/anthropic";

// AI company brief (build item 5). The company is re-loaded withOrg-scoped from
// the id in the form (never trusting a client-passed payload), so a foreign id
// resolves null → we never brief another tenant's company. The Anthropic call
// happens server-side in @/lib/anthropic; the key never reaches the browser.
//
// This is a useActionState action: it returns state rather than throwing, so
// model/network failures render inline instead of tripping the error boundary.
// Nothing is persisted — the brief is ephemeral (no schema field for it yet).

export type BriefState =
  | { status: "idle" }
  | { status: "ok"; brief: string }
  | { status: "error"; message: string };

export async function generateBrief(
  _prev: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const company = await withOrg(orgId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      include: {
        contacts: { orderBy: { name: "asc" }, select: { name: true, title: true } },
        projectLinks: {
          orderBy: { role: "asc" },
          include: { project: { select: { name: true, stage: true } } },
        },
      },
    }),
  );

  if (company == null)
    return { status: "error", message: "company not found in this organization" };

  try {
    const brief = await generateCompanyBrief({
      name: company.name,
      status: company.status,
      industry: company.industry,
      tier: company.tier,
      annualValue:
        company.annualValue == null ? null : String(company.annualValue),
      temperature: company.temperature,
      source: company.source,
      emailDomain: company.emailDomain,
      website: company.website,
      notes: company.notes,
      contacts: company.contacts.map((c) => ({ name: c.name, title: c.title })),
      projects: company.projectLinks.map((l) => ({
        name: l.project.name,
        stage: l.project.stage,
        role: l.role,
      })),
    });
    return { status: "ok", brief };
  } catch (err) {
    // Surface a friendly message; log the real cause server-side for triage.
    console.error("brief generation failed", err);
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not generate a brief. Try again." };
  }
}
