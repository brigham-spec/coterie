"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  generateProactivePairings,
  pairKey,
  type ProactivePairing,
} from "@/lib/intro-engine";
import { introProfileInclude, toIntroProfile } from "@/lib/intro-profile";

// Proactive introduction scan (slice 11.4c, ported from the prototype's
// doProactiveAlertScan) — the dashboard's Layer-0 panel. The whole network is
// loaded in ONE withOrg tx (RLS scopes it to this tenant), reduced to intro
// profiles, and handed to the engine, which returns the strongest NEW pairings to
// make right now. Already-made introductions and user dismissals (intro_dismissals)
// are folded into an orientation-independent excluded-pair set so nothing stale or
// waved-off resurfaces. Results are EPHEMERAL — regenerated on demand, not stored.
//
// Like the other AI features this is a useActionState action: it returns state
// rather than throwing, so model/network failures render inline in the card.

export type ProactiveScanState =
  | { status: "idle" }
  | { status: "ok"; pairings: ProactivePairing[] }
  | { status: "error"; message: string };

export async function scanNetworkIntros(
  _prev: ProactiveScanState,
  _formData: FormData,
): Promise<ProactiveScanState> {
  const { orgId } = await requireOrgContext();

  const data = await withOrg(orgId, async (tx) => {
    const companies = await tx.company.findMany({ include: introProfileInclude });
    const intros = await tx.introduction.findMany({
      select: {
        partyA: { select: { companyId: true } },
        partyB: { select: { companyId: true } },
      },
    });
    const dismissals = await tx.introDismissal.findMany({
      select: { focusCompanyId: true, candidateCompanyId: true },
    });
    return { companies, intros, dismissals };
  });

  // Orientation-independent set of pairs to keep out of the results.
  const excludedPairs = new Set<string>();
  for (const i of data.intros)
    excludedPairs.add(pairKey(i.partyA.companyId, i.partyB.companyId));
  for (const d of data.dismissals)
    excludedPairs.add(pairKey(d.focusCompanyId, d.candidateCompanyId));

  const profiles = data.companies.map(toIntroProfile);

  try {
    await enforceAiRateLimit(orgId);
    const pairings = await generateProactivePairings(profiles, excludedPairs);
    return { status: "ok", pairings };
  } catch (err) {
    console.error("proactive intro scan failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not scan the network. Try again." };
  }
}

// Global command-palette search (review Tier-1) — matches companies, contacts,
// and projects by name for _command-palette.tsx. RLS scopes every read to the
// caller's tenant via withOrg, so results can never span organizations. Bounded
// per type so the palette stays scannable.

export type SearchResultType = "company" | "contact" | "project";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  label: string;
  sublabel: string;
  href: string;
};

const SEARCH_PER_TYPE = 6;

function titleize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function searchNetwork(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  // One character is too broad to be useful; the client still shows nav commands.
  if (q.length < 2) return [];

  const { orgId } = await requireOrgContext();

  return withOrg(orgId, async (tx) => {
    // A withOrg tx holds a single pooled connection, so its reads run
    // sequentially — issuing them concurrently would serialize under contention.
    const companies = await tx.company.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: SEARCH_PER_TYPE,
      select: { id: true, name: true, status: true, industry: true },
    });
    const contacts = await tx.contact.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: SEARCH_PER_TYPE,
      select: {
        id: true,
        name: true,
        title: true,
        company: { select: { name: true } },
      },
    });
    const projects = await tx.project.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      orderBy: { name: "asc" },
      take: SEARCH_PER_TYPE,
      select: { id: true, name: true, stage: true },
    });

    return [
      ...companies.map(
        (c): SearchResult => ({
          type: "company",
          id: c.id,
          label: c.name,
          sublabel: c.industry || titleize(c.status),
          href: `/dashboard/companies/${c.id}`,
        }),
      ),
      ...contacts.map(
        (c): SearchResult => ({
          type: "contact",
          id: c.id,
          label: c.name,
          sublabel: [c.title, c.company.name].filter(Boolean).join(" \u00b7 "),
          href: `/dashboard/contacts/${c.id}`,
        }),
      ),
      ...projects.map(
        (p): SearchResult => ({
          type: "project",
          id: p.id,
          label: p.name,
          sublabel: titleize(p.stage),
          href: `/dashboard/projects/${p.id}`,
        }),
      ),
    ];
  });
}
