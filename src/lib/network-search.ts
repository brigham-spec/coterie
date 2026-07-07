import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// Network search engine (slice 11.5, ported from the prototype's searchNetwork).
// Natural-language search over the tenant's own companies: the user asks a question
// in plain English ("who has IDA financing experience?") and the model returns the
// best-matching companies with a reason and a relevance score. Like the other AI
// features this is the single server-only seam — prompt, model, and output shape
// live here so tenant data only leaves through a shape we control and the API key
// never reaches the browser. Results are EPHEMERAL (nothing stored).

// A company reduced to the free-text signals the model searches over. Kept factual
// so matches are grounded rather than invented.
export type NetworkSearchProfile = {
  id: string;
  name: string;
  industry: string;
  contactName: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  counties: string[];
  dealSize: string | null;
  agencyContacts: string | null;
  notes: string;
  projects: string[];
};

export type NetworkSearchMatch = {
  companyId: string;
  companyName: string;
  contactName: string;
  why: string;
  relevance: number;
  keyDetail: string;
};

// The model is asked for at most this many matches, mirroring the prototype.
const MAX_MATCHES = 8;

function coerceMatch(
  item: unknown,
  validIds: ReadonlySet<string>,
): NetworkSearchMatch | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const companyId = typeof o.companyId === "string" ? o.companyId : "";
  // Reject anything the model invented that isn't a real company id.
  if (!validIds.has(companyId)) return null;

  const relRaw =
    typeof o.relevance === "number" ? o.relevance : Number(o.relevance);
  if (!Number.isFinite(relRaw)) return null;
  const relevance = Math.max(1, Math.min(5, Math.round(relRaw)));

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  return {
    companyId,
    companyName: str(o.companyName),
    contactName: str(o.contactName),
    why: str(o.why),
    relevance,
    keyDetail: str(o.keyDetail),
  };
}

/// PURE: parse + validate the model's JSON array into matches, dropping any entry
/// whose companyId isn't a real company (no hallucinated results), sorting by
/// relevance (desc) and capping to MAX_MATCHES. Robust to non-JSON / non-array
/// responses.
export function parseNetworkMatches(
  raw: string,
  validIds: ReadonlySet<string>,
): NetworkSearchMatch[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: NetworkSearchMatch[] = [];
  for (const item of parsed) {
    const m = coerceMatch(item, validIds);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.relevance - a.relevance);
  return out.slice(0, MAX_MATCHES);
}

// PURE: render one profile as the terse line block the model reads.
function profileLine(p: NetworkSearchProfile): string {
  return [
    `ID:${p.id} | ${p.name} | ${p.industry}`,
    p.contactName ? `Contact: ${p.contactName}` : "",
    p.lookingFor ? `Needs: ${p.lookingFor}` : "",
    p.canOffer ? `Offers: ${p.canOffer}` : "",
    p.projects.length ? `Projects: ${p.projects.join(", ")}` : "",
    p.counties.length ? `Counties: ${p.counties.join(", ")}` : "",
    p.dealSize ? `Deal size: ${p.dealSize}` : "",
    p.agencyContacts ? `Agency contacts: ${p.agencyContacts}` : "",
    p.notes ? `Notes: ${p.notes.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

const SYSTEM_PROMPT = `You are a network intelligence assistant for an economic-development membership network. A user searches the member companies in natural language; find the companies that best match.

Consider each company's stated expertise, what it can offer, its industry, active projects, counties, deal types, and notes. Look for both direct matches ("who does X") and contextual matches (a company whose background clearly covers X even if not stated explicitly). Ground every match in the supplied data — do not invent expertise, projects, or people that are not present.

Return ONLY a JSON array (no prose, no markdown code fences), ranked by relevance. Each element:
{"companyId": "<one of the supplied ids>", "companyName": "<name>", "contactName": "<primary contact or empty>", "why": "<1-2 sentences: specifically why this company matches>", "relevance": <1-5>, "keyDetail": "<the single most relevant thing about them for this query>"}
companyId MUST be one of the supplied ids. Return up to ${MAX_MATCHES} genuinely-matching companies. If nobody matches well, return [].`;

/// Run a natural-language search over the supplied company profiles. Validates the
/// model's output against the supplied ids (no hallucinated results). Ephemeral.
export async function generateNetworkMatches(
  query: string,
  profiles: NetworkSearchProfile[],
): Promise<NetworkSearchMatch[]> {
  if (profiles.length === 0) return [];

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `USER QUERY: "${query}"\n\nCOMPANY PROFILES:\n${profiles.map(profileLine).join("\n\n")}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const validIds = new Set(profiles.map((p) => p.id));
  return parseNetworkMatches(text, validIds);
}
