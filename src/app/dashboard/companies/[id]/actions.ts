"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { generateCompanyBrief } from "@/lib/anthropic";
import {
  eligibleCandidateIds,
  generateIntroSuggestions,
  type IntroCompanyProfile,
  type IntroSuggestion,
} from "@/lib/intro-engine";

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

// Per-member intro suggestions (slice 11.4b). The focus company and the candidate
// pool are re-loaded withOrg-scoped from the id in the form (never trusting a
// client payload), so a foreign id resolves null and no other tenant's network is
// scanned. Companies already introduced to the focus (via any contact pair) are
// excluded before the model sees the pool. Ephemeral — nothing is persisted.

const introProfileInclude = {
  contacts: {
    orderBy: { name: "asc" },
    select: { name: true, title: true, isPrimary: true },
  },
  projectLinks: {
    orderBy: { role: "asc" },
    include: { project: { select: { name: true, stage: true } } },
  },
} as const;

type CompanyWithProfile = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  tier: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  networkTags: string[];
  counties: string[];
  contacts: Array<{ name: string; title: string | null; isPrimary: boolean }>;
  projectLinks: Array<{ role: string; project: { name: string; stage: string } }>;
};

function toIntroProfile(c: CompanyWithProfile): IntroCompanyProfile {
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    industry: c.industry,
    tier: c.tier,
    lookingFor: c.lookingFor,
    canOffer: c.canOffer,
    networkTags: c.networkTags,
    counties: c.counties,
    primaryContact: primary
      ? { name: primary.name, title: primary.title }
      : null,
    projects: c.projectLinks.map((l) => ({
      name: l.project.name,
      stage: l.project.stage,
      role: l.role,
    })),
  };
}

export type IntroSuggestState =
  | { status: "idle" }
  | { status: "ok"; suggestions: IntroSuggestion[] }
  | { status: "error"; message: string };

export async function suggestIntros(
  _prev: IntroSuggestState,
  formData: FormData,
): Promise<IntroSuggestState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { status: "error", message: "missing company" };

  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const focus = await tx.company.findUnique({
      where: { id: companyId },
      include: introProfileInclude,
    });
    if (focus == null) return null;

    const companies = await tx.company.findMany({
      include: introProfileInclude,
    });
    const intros = await tx.introduction.findMany({
      select: {
        partyA: { select: { companyId: true } },
        partyB: { select: { companyId: true } },
      },
    });
    // Durable dismissals touching the focus, either orientation (slice 11.4c) —
    // a pairing the user has waved off should not resurface on the next scan.
    const dismissals = await tx.introDismissal.findMany({
      where: {
        OR: [{ focusCompanyId: companyId }, { candidateCompanyId: companyId }],
      },
      select: { focusCompanyId: true, candidateCompanyId: true },
    });
    return { focus, companies, intros, dismissals };
  });

  if (data == null)
    return { status: "error", message: "company not found in this organization" };

  // Companies excluded from the pool: already introduced to the focus (either
  // direction, any contact pair) OR dismissed against it (either orientation).
  const excluded = new Set<string>();
  for (const i of data.intros) {
    if (i.partyA.companyId === companyId) excluded.add(i.partyB.companyId);
    if (i.partyB.companyId === companyId) excluded.add(i.partyA.companyId);
  }
  for (const d of data.dismissals) {
    if (d.focusCompanyId === companyId) excluded.add(d.candidateCompanyId);
    if (d.candidateCompanyId === companyId) excluded.add(d.focusCompanyId);
  }

  const eligible = new Set(
    eligibleCandidateIds(
      companyId,
      data.companies.map((c) => c.id),
      excluded,
    ),
  );
  const candidates = data.companies
    .filter((c) => eligible.has(c.id))
    .map(toIntroProfile);

  try {
    const suggestions = await generateIntroSuggestions(
      toIntroProfile(data.focus),
      candidates,
    );
    return { status: "ok", suggestions };
  } catch (err) {
    console.error("intro suggestions failed", err);
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not generate suggestions. Try again." };
  }
}

// Persist a "don't suggest this pairing again" decision (slice 11.4c). The pair is
// stored directionally (focus → candidate); suggestIntros excludes either
// orientation on the next scan. Both companies are re-verified withOrg-scoped
// (RLS → a foreign id resolves null → refused) before writing, and the write is an
// idempotent upsert on the unique pair so re-dismissing is a no-op.
export async function dismissIntro(
  focusCompanyId: string,
  candidateCompanyId: string,
): Promise<void> {
  const focus = String(focusCompanyId ?? "").trim();
  const candidate = String(candidateCompanyId ?? "").trim();
  if (!focus || !candidate || focus === candidate) return;

  const { orgId } = await requireOrgContext();

  await withOrg(orgId, async (tx) => {
    const [f, c] = await Promise.all([
      tx.company.findUnique({ where: { id: focus }, select: { id: true } }),
      tx.company.findUnique({ where: { id: candidate }, select: { id: true } }),
    ]);
    if (!f || !c) throw new Error("company not found in this organization");

    await tx.introDismissal.upsert({
      where: {
        orgId_focusCompanyId_candidateCompanyId: {
          orgId,
          focusCompanyId: focus,
          candidateCompanyId: candidate,
        },
      },
      create: { orgId, focusCompanyId: focus, candidateCompanyId: candidate },
      update: {},
    });
  });
}
