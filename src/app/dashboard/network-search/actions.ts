"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
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
  counties: string[];
  contacts: Array<{ name: string; isPrimary: boolean }>;
  projectLinks: Array<{ project: { name: string } }>;
};

function toSearchProfile(c: CompanyRow): NetworkSearchProfile {
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
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

export type NetworkSearchState =
  | { status: "idle" }
  | { status: "ok"; query: string; matches: NetworkSearchMatch[] }
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
    const matches = await generateNetworkMatches(query, profiles);
    return { status: "ok", query, matches };
  } catch (err) {
    console.error("network search failed", err);
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not search the network. Try again." };
  }
}
