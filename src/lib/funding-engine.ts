import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";
import { isFundingCategory } from "@/lib/funding";
import { getRegionalProgramsForCounty } from "@/lib/regional-programs";

// Funding-suggestion engine (projects-module parity; ported from the prototype's
// AI Suggest button in the Funding Sources & Grants section, Coterie.html:10400).
// Given a project's facts, Claude identifies the state/federal/alternative capital
// programs the project ACTUALLY qualifies for — grounded by strict eligibility
// gates and a library of known Hudson Valley county/municipal programs injected by
// county. Like the other AI seams this is the single server-only place the prompt,
// model, and output shape live so the Anthropic key never reaches the browser. The
// result is EPHEMERAL — the operator reviews and tracks suggestions via the funding
// card; nothing is written here.

// The slice of a project the model reasons over. Factual and terse so the model
// matches programs to real attributes rather than embellishing.
export type FundingProjectContext = {
  name: string;
  type: string | null;
  stage: string | null;
  county: string | null;
  industry: string | null;
  value: string | null;
  units: number | null;
  description: string | null;
};

// A suggested program the operator can track. `category` is validated to the
// funding vocabulary; the rest are free text the card renders.
export type FundingSuggestion = {
  name: string;
  agency: string;
  category: string;
  estimatedBenefit: string;
  rationale: string;
  action: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string.
function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function coerceSuggestion(item: unknown): FundingSuggestion | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const name = str(o.name, 200);
  // A suggestion with no program name is useless — drop it.
  if (name === "") return null;
  const categoryRaw = str(o.category, 40);
  // Fall back to Grant (the most common) for an out-of-vocab category so a
  // slightly-off model response is still trackable.
  const category = isFundingCategory(categoryRaw) ? categoryRaw : "Grant";
  return {
    name,
    agency: str(o.agency, 200),
    category,
    estimatedBenefit: str(o.estimatedBenefit, 200),
    rationale: str(o.rationale, 500),
    action: str(o.action, 300),
  };
}

/// PURE: parse + validate the model's JSON array into funding suggestions,
/// dropping any entry with no program name and normalizing categories to the
/// funding vocabulary. Robust to non-JSON / non-array responses.
export function parseFundingSuggestions(raw: string): FundingSuggestion[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: FundingSuggestion[] = [];
  for (const item of parsed) {
    const s = coerceSuggestion(item);
    if (s) out.push(s);
  }
  return out;
}

// The eligibility gates that keep the model honest about which programs a project
// actually qualifies for (ported verbatim from the prototype). The single most
// important part of this feature — without it the model over-suggests.
const ELIGIBILITY_GATES = `CRITICAL ELIGIBILITY RULES — only suggest programs the project qualifies for:
- Excelsior Jobs: ONLY for manufacturing, software/tech, R&D, financial services (100+ jobs), clean energy, agriculture, or distribution. DO NOT suggest for hospitality, retail, or general service businesses.
- 9% LIHTC (competitive NY HCR allocation): DO NOT suggest unless the project has 80+ units AND primarily targets 30-60% AMI. Projects at 60-90% AMI are weak candidates — the credit rewards deep affordability. Projects under 60 units are not competitive in NY and cannot absorb legal/compliance costs. Very difficult to access.
- 4% LIHTC + HFA Tax-Exempt Bonds: Non-competitive but only feasible at 100+ units — bond issuance carries $300-500k in fixed costs that do not pencil for smaller projects. Do NOT suggest for projects under 80 units.
- HOME / HTF / HCR Affordable Housing Fund (AHF) grants: Gap grant financing accessible at any project scale. STRONGLY PREFER over LIHTC for projects under 60 units or primarily targeting 60-90% AMI — far more realistic for smaller affordable deals.
- IDA 421p PILOT: Available in municipalities where school board has opted in. Size-agnostic and highly relevant for affordable housing in active IDA jurisdictions (Kingston, Newburgh, Poughkeepsie, etc.).
- Historic Tax Credits: ONLY if description indicates a historic or NR-listed building.
- USDA Rural Development / REAP: ONLY for rural areas per USDA eligibility maps. REAP for ag/rural energy only.
- New Markets Tax Credits: ONLY in census-designated low-income communities.
- Restore NY: ONLY for vacant/abandoned/underutilized commercial or industrial buildings.
- DRI: State-selected communities — do not suggest unless the municipality is in an active DRI round.
- C-PACE: ONLY for energy efficiency or renewable energy improvements on commercial property.
- IDA (PILOT/tax exemptions): Broadly applicable to commercial and industrial development in NY.
- SBA 504: Fixed assets (real estate, equipment) — broadly applicable to small businesses.
- CFA / REDC: Annual ESD round — open to wide range of economic development projects in NY.
- CPC (Community Preservation Corporation) PLP: DEBT vehicle (not a grant). Senior construction-to-perm loan for affordable multifamily in NY. Strongly applicable for income-restricted projects (20-150 units, AMI-targeted) where conventional lenders will not lend. Pairs with LIHTC equity, HOME grants, and IDA benefits. Not for market-rate or commercial-only projects.
- HCR Preferred Lender Program (PLP): Below-market permanent financing for 4% LIHTC + tax-exempt bond deals. Debt vehicle for income-restricted rental housing using HFA bonds.
- NY HFA Tax-Exempt Bonds: Bond financing for 30+ unit income-restricted rental projects in the 4% LIHTC stack.`;

const OUTPUT_SHAPE = `Each object: {"name":"program name","agency":"agency","category":"Grant|Loan|Tax Benefit|Bond|Equity","estimatedBenefit":"range or %","rationale":"why this project qualifies (1-2 sentences)","action":"immediate next step"}`;

// PURE: is the context rich enough for strict-eligibility mode, or so sparse we
// fall back to exploratory mode? (mirrors the prototype's _contextRich check).
function isContextRich(project: FundingProjectContext): boolean {
  return Boolean(
    project.description ||
      project.industry ||
      (project.value && project.value !== "0") ||
      (project.units && project.units > 0),
  );
}

/// PURE: the user prompt handed to the model. Assembles the project facts, injects
/// the county's known regional programs, and applies the eligibility gates —
/// choosing strict mode for a well-described project or exploratory mode for a
/// sparse one (still respecting the gates).
export function buildFundingPrompt(project: FundingProjectContext): string {
  const facts = [
    `Project Name: ${project.name || "Unnamed"}`,
    project.type ? `Type: ${project.type}` : "",
    project.stage ? `Stage: ${project.stage}` : "",
    `County: ${project.county || "Hudson Valley, NY"}`,
    project.industry ? `Industry: ${project.industry}` : "",
    project.value && project.value !== "0" ? `Estimated Value: $${project.value}` : "",
    project.units && project.units > 0 ? `Units/Keys: ${project.units}` : "",
    project.description ? `Description: ${project.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const programs = getRegionalProgramsForCounty(project.county);
  const regionalContext = programs.length
    ? `\nKNOWN LOCAL PROGRAMS for ${project.county} County (from the program library — ALWAYS evaluate and include if applicable):\n` +
      programs
        .map((p) => {
          const who =
            p.applicant === "developer"
              ? "Developer applies directly"
              : p.applicant === "municipality"
                ? "MUNICIPALITY must apply - developer works through them"
                : "Either party can lead";
          return `- ${p.name} (${p.type} | WHO APPLIES: ${who}): ${p.eligibility}${p.maxAmount ? ` Max: ${p.maxAmount}` : ""}${p.notes ? ` Notes: ${p.notes}` : ""}`;
        })
        .join("\n")
    : "";

  if (isContextRich(project)) {
    return `You are a New York State economic development financing expert.

${ELIGIBILITY_GATES}

PROJECT TO ANALYZE:
${facts}${regionalContext}

Return ONLY a valid JSON array of 4-6 programs this project ACTUALLY QUALIFIES FOR.
${OUTPUT_SHAPE}
Do not suggest programs the project does not qualify for.
IMPORTANT: For affordable housing projects (income-restricted units), LIHTC, HOME, HCR, and IDA programs almost always apply — do not omit them.
Always return at least the 3-4 programs best suited to this project. Never return an empty array unless the project description is completely blank.`;
  }

  return `You are a New York State economic development financing expert.

This project has limited details. Suggest 4-6 funding programs commonly applicable to this project type in New York's Hudson Valley region.

${ELIGIBILITY_GATES}

PROJECT:
${facts}${regionalContext}

Return a JSON array with 4-6 programs. For programs where eligibility depends on details not yet provided, include a note in the rationale about what to verify.
${OUTPUT_SHAPE}
Return ONLY the JSON array with no other text.`;
}

const SYSTEM_PROMPT = `You are a New York State economic development financing expert. You identify the funding programs a project genuinely qualifies for and return ONLY a JSON array of program objects with the requested keys. Ground every suggestion in the project's real attributes and the supplied eligibility rules — never suggest a program the project does not qualify for.`;

/// Identify the funding programs a project qualifies for. Ephemeral — nothing is
/// stored; the operator reviews and tracks suggestions via the card. Returns an
/// empty array when the model gives nothing usable.
export async function generateFundingSuggestions(
  project: FundingProjectContext,
): Promise<FundingSuggestion[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildFundingPrompt(project) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseFundingSuggestions(text);
}
