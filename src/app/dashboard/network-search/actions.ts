"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { introProfileInclude } from "@/lib/intro-profile";
import {
  generateNetworkMatches,
  type NetworkSearchMatch,
  type NetworkSearchProfile,
} from "@/lib/network-search";

// Natural-language network search (slice 11.5, ported from the prototype's
// searchNetwork). The whole tenant network is loaded in ONE withOrg tx (RLS scopes
// it), reduced to search profiles, and handed to the engine, which returns the
// best-matching companies. Former members are excluded (searching your active
// network, like the prototype's non-archived filter). Results are EPHEMERAL —
// regenerated on demand, never stored. Like the other AI features this is a
// useActionState action: it returns state rather than throwing, so model/network
// failures render inline.

// The Prisma row shape a search profile is built from (a superset of what
// introProfileInclude selects plus the scalar fields we read).
type CompanyRow = {
  id: string;
  name: string;
  industry: string;
  notes: string;
  lookingFor: string | null;
  canOffer: string | null;
  agencyContacts: string | null;
  dealSize: string | null;
  tier: string | null;
  counties: string[];
  contacts: Array<{ id: string; name: string; isPrimary: boolean }>;
  projectLinks: Array<{ project: { name: string } }>;
};

// The company's primary contact (explicit flag wins, else the first) — the one
// the search reads for a name and links into the Intro Engine as Party A.
function primaryContact(c: CompanyRow): CompanyRow["contacts"][number] | null {
  return c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
}

function toSearchProfile(c: CompanyRow): NetworkSearchProfile {
  const primary = primaryContact(c);
  return {
    id: c.id,
    name: c.name,
    industry: c.industry,
    contactName: primary?.name ?? null,
    lookingFor: c.lookingFor,
    canOffer: c.canOffer,
    counties: c.counties,
    dealSize: c.dealSize,
    agencyContacts: c.agencyContacts,
    notes: c.notes,
    projects: c.projectLinks.map((l) => l.project.name),
  };
}

// A match enriched with data that lives on the Company row (not in the pure
// NetworkSearchMatch the engine returns), joined back on here by id: the
// org-configured member tier (free-text, null when unranked) and the primary
// contact's id (to seed the Intro Engine's Party A; null when the company has
// no contacts).
export type NetworkSearchResult = NetworkSearchMatch & {
  tier: string | null;
  introContactId: string | null;
};

export type NetworkSearchState =
  | { status: "idle" }
  | { status: "ok"; query: string; matches: NetworkSearchResult[] }
  | { status: "error"; message: string };

export async function searchNetwork(
  _prev: NetworkSearchState,
  formData: FormData,
): Promise<NetworkSearchState> {
  const { orgId } = await requireOrgContext();

  const query = String(formData.get("query") ?? "").trim();
  if (!query) return { status: "error", message: "Enter a search query." };

  const companies = await withOrg(orgId, (tx) =>
    tx.company.findMany({
      where: { status: { not: "former" } },
      include: introProfileInclude,
    }),
  );

  const profiles = companies.map(toSearchProfile);

  try {
    await enforceAiRateLimit(orgId);
    const matches = await generateNetworkMatches(query, profiles);
    const metaById = new Map(
      companies.map((c) => [
        c.id,
        { tier: c.tier, introContactId: primaryContact(c)?.id ?? null },
      ]),
    );
    const enriched = matches.map((m) => {
      const meta = metaById.get(m.companyId);
      return {
        ...m,
        tier: meta?.tier ?? null,
        introContactId: meta?.introContactId ?? null,
      };
    });
    return { status: "ok", query, matches: enriched };
  } catch (err) {
    console.error("network search failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not search the network. Try again." };
  }
}
