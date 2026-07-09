import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// Prospect finder engine (slice 11.6, ported from the prototype's
// fetchProspectTargets). Unlike Network Search — which searches the tenant's OWN
// companies — this discovers NEW organisations OUTSIDE the CRM using Claude's
// web_search tool, then scores each as a membership prospect. Two modes:
//   • recommendations — analyse the network's gaps (missing industries, unmet
//     "looking for" needs, services active projects lack, underserved counties)
//     and find real people/orgs that fill them. Richer reasoning → opus.
//   • targeted — a focused search by free text + filters (industry / county /
//     project type / a named person). Simpler → the faster haiku model.
// Like the other AI features this is the single server-only seam: prompt, model,
// tool config, and output shape live here so the API key never reaches the
// browser. Results are EPHEMERAL until the user explicitly adds one as a prospect.

export type ProspectMode = "recommendations" | "targeted";

export type ProspectFilters = {
  industry: string;
  county: string;
  projectType: string;
  person: string;
};

// One discovered organisation, scored as a membership fit. These are EXTERNAL —
// no company id — so validation is shape-based, not id-based.
export type ProspectTarget = {
  org: string;
  contact: string;
  title: string;
  industry: string;
  county: string;
  why: string;
  theyGet: string;
  theyBring: string;
  connectWith: string;
  whyNow: string;
  website: string | null;
  score: number;
};

// The tenant context the recommendations mode reasons over. Terse and factual so
// the model grounds its gap analysis rather than inventing needs.
export type ProspectSearchInput = {
  mode: ProspectMode;
  focusArea: string;
  filters: ProspectFilters;
  members: Array<{ name: string; industry: string }>;
  needs: Array<{ name: string; lookingFor: string; canOffer: string }>;
  projects: Array<{ name: string; stage: string; type: string; county: string }>;
  // Every org name to keep OUT of results (a superset of `members` — includes
  // existing prospects too, so we never re-surface someone already tracked).
  excludeOrgs: string[];
};

// The model is asked for this many prospects, mirroring the prototype.
const TARGET_COUNT = 6;
// Defensive cap on how many we accept back.
const MAX_TARGETS = 10;

function coerceTarget(
  item: unknown,
  excluded: ReadonlySet<string>,
): ProspectTarget | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const org = str(o.org);
  // A prospect with no organisation name is unusable; drop it.
  if (org === "") return null;
  // Backstop the prompt's exclusion instruction — never surface a name already
  // in the network/pipeline.
  if (excluded.has(org.toLowerCase())) return null;

  // Score is advisory here (external result), so tolerate a missing/garbled
  // value by defaulting to the middle rather than dropping a real find.
  const scoreRaw = typeof o.score === "number" ? o.score : Number(o.score);
  const score = Number.isFinite(scoreRaw)
    ? Math.max(1, Math.min(5, Math.round(scoreRaw)))
    : 3;

  const websiteRaw = str(o.website);
  const website = /^https?:\/\//i.test(websiteRaw) ? websiteRaw : null;

  return {
    org,
    contact: str(o.contact),
    title: str(o.title),
    industry: str(o.industry),
    county: str(o.county),
    why: str(o.why),
    theyGet: str(o.theyGet),
    theyBring: str(o.theyBring),
    connectWith: str(o.connectWith),
    whyNow: str(o.whyNow),
    website,
    score,
  };
}

/// PURE: parse + validate the model's JSON array into scored prospects, dropping
/// entries with no org name or whose org is already in the network/pipeline
/// (case-insensitive), sorting by score (desc) and capping to MAX_TARGETS. Robust
/// to non-JSON / non-array responses (web-search replies can be chatty).
export function parseProspectTargets(
  raw: string,
  excludeOrgs: Iterable<string> = [],
): ProspectTarget[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const excluded = new Set(
    [...excludeOrgs].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  const out: ProspectTarget[] = [];
  for (const item of parsed) {
    const t = coerceTarget(item, excluded);
    if (t) out.push(t);
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_TARGETS);
}

// PURE: assemble the mode-specific search focus block.
function buildSearchFocus(input: ProspectSearchInput): string {
  if (input.mode === "recommendations") {
    const needs =
      input.needs
        .map((n) => `${n.name}: needs="${n.lookingFor}" offers="${n.canOffer}"`)
        .join("\n") || "(none specified yet)";
    const projects =
      input.projects
        .map((p) => `${p.name} (${p.stage}, ${p.type || "—"}, ${p.county || "HV"} County)`)
        .join("\n") || "(none active)";
    return `Analyse the member network and identify the GAPS — industries, specialties, or types of organisation that are underrepresented but would add the most value to this group. Then find real people and organisations that fill those gaps.
Consider:
- What industries are missing that current members need?
- What do members say they are "looking for" that nobody in the network offers?
- What project types are active but missing key professional services?
- What counties are underserved in the network?
Member "looking for" needs:
${needs}
Active projects needing support:
${projects}`;
  }

  const parts: string[] = [];
  if (input.focusArea) parts.push(input.focusArea);
  if (input.filters.industry) parts.push(`Industry: ${input.filters.industry}`);
  if (input.filters.county)
    parts.push(`County: ${input.filters.county}, Hudson Valley NY`);
  if (input.filters.projectType)
    parts.push(`Project type: ${input.filters.projectType}`);
  if (input.filters.person) parts.push(`Find specifically: ${input.filters.person}`);
  return (
    parts.join("\n") ||
    "High-value Hudson Valley executives in real estate, construction, hospitality, legal, and finance"
  );
}

// PURE: the full user prompt handed to the model (with the web_search tool).
function buildPrompt(input: ProspectSearchInput): string {
  const summary = input.members
    .map((m) => `${m.name} (${m.industry})`)
    .join(", ");
  const focus = buildSearchFocus(input);
  const extra =
    input.mode === "targeted" && input.filters.person
      ? `\n\nIMPORTANT: Prioritize finding "${input.filters.person}" specifically.`
      : "";
  const excludePipeline =
    input.mode !== "recommendations" && input.excludeOrgs.length
      ? `ALSO EXCLUDE (already in pipeline):\n${input.excludeOrgs.join(", ")}\n\n`
      : "";

  return `You are a business-development strategist for a Hudson Valley, NY economic-development membership network of senior real estate, construction, hospitality, legal, and finance executives.

CURRENT NETWORK (do NOT suggest any of these):
${summary || "(network is empty)"}
${excludePipeline}SEARCH FOCUS:
${focus}${extra}

Search the web for ${TARGET_COUNT} real Hudson Valley executives or organisations NOT in the network above. Use recent news (last 12 months) to find active players. Return them as a JSON array ONLY — no preamble, no markdown code fences, no explanation:
[{"org":"<name>","contact":"<person>","title":"<role>","industry":"<sector>","county":"<HV county>","why":"<1 sentence>","theyGet":"<what the network offers them>","theyBring":"<what they add to the network>","connectWith":"<2 current members>","whyNow":"<reason to reach out now>","website":"<url or null>","score":<1-5>}]
Ground every prospect in real, verifiable information from your search — do not invent organisations or people.`;
}

// The two models, tiered by task depth (recommendations reasons over the whole
// network; targeted is a focused lookup).
const MODEL: Record<ProspectMode, string> = {
  recommendations: "claude-opus-4-6",
  targeted: "claude-haiku-4-5-20251001",
};

/// Discover external prospects via web search and score them. Validates output
/// shape and drops anyone already in the network. Ephemeral — nothing is stored
/// until the caller adds a prospect.
export async function generateProspectTargets(
  input: ProspectSearchInput,
): Promise<ProspectTarget[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL[input.mode],
    max_tokens: 3500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseProspectTargets(text, input.excludeOrgs);
}
