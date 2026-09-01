import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";
import { getStageDef, isProjectStage, PROJECT_STAGES } from "@/lib/project-stages";

// Project enrichment engine (ported from the prototype's generateEnrichment
// proposals + applyEnrichment, Coterie.html:9928 / 9980). Reads the coverage
// saved to one project — its cross-linked and participant-company news — and
// proposes updates to the project's own structured fields (stage, county, value,
// units, sqft, lead, description). Like the other AI seams this is server-only:
// the prompt, model, and output shape live here. The result is EPHEMERAL — only
// the fields the operator explicitly applies are written (via applyProjectUpdates
// in projects/enrich-actions).
//
// Accuracy is paramount: every proposal must be traceable to an article above,
// and NO proposal is always preferable to an invented one. Team members and the
// economic-impact rollup are intentionally NOT proposed here — production keeps
// those in relational/Json stores with their own editors, so the engine stays on
// the project's plain scalar columns.

// The project being enriched, with its current field values so the model can tell
// what is already known and only surface genuinely new intelligence.
export type ProjectEnrichContext = {
  name: string;
  stage: string;
  county: string;
  value: string;
  units: string;
  sqft: string;
  prospectLead: string;
  description: string;
};

// One article the enrichment reasons over, already flattened to display strings
// by the calling action.
export type EnrichArticle = { headline: string; summary: string };

// The writable project fields the engine may propose, in review order. `stage` is
// validated against the pipeline vocabulary; the numeric fields are coerced to a
// bare integer string; the rest are bounded free text. Kept as a const tuple so
// both the parser and the apply action share one source of truth.
export const ENRICH_FIELDS = [
  { key: "stage", label: "Stage", kind: "stage" },
  { key: "county", label: "County", kind: "text" },
  { key: "value", label: "Value ($)", kind: "int" },
  { key: "units", label: "Units / keys", kind: "int" },
  { key: "sqft", label: "Square footage", kind: "int" },
  { key: "prospectLead", label: "Developer / lead", kind: "text" },
  { key: "description", label: "Description", kind: "text" },
] as const;

export type EnrichField = (typeof ENRICH_FIELDS)[number]["key"];

const FIELD_BY_KEY = new Map(ENRICH_FIELDS.map((f) => [f.key, f]));

// One proposed change. `currentValue` echoes the project's present value so the
// review shows before/after; `confidence` grades how directly the article stated
// it (high = explicit, medium = strongly implied, low = reasonably inferred).
export type ProjectProposal = {
  field: EnrichField;
  label: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

// PURE: coerce any JSON value to a trimmed, bounded string.
function str(value: unknown, max: number): string {
  if (typeof value !== "string") {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }
  return value.trim().slice(0, max);
}

// PURE: coerce a proposed numeric field to a bare non-negative integer string, or
// "" when it isn't a clean number. Strips currency/commas the model may include.
function intStr(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : str(value, 40);
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return "";
  return String(Number(cleaned));
}

/// PURE: coerce one proposed value to its clean stored form by the field's kind
/// — int → bare digits, stage → a value in the pipeline vocabulary (else ""),
/// text → trimmed + length-bounded. Returns "" for an unknown field or anything
/// that fails its kind's rule. The single source of truth the AI parser AND the
/// apply action's re-validation both run through, so parse and write can't drift.
export function coerceProposedValue(field: string, value: unknown): string {
  const def = FIELD_BY_KEY.get(field as EnrichField);
  if (!def) return "";
  if (def.kind === "int") return intStr(value);
  if (def.kind === "stage") {
    const v = str(value, 40);
    return isProjectStage(v) ? v : "";
  }
  return str(value, field === "description" ? 2000 : 200);
}

/// PURE: parse the model's raw completion into validated proposals. Pulls the
/// JSON array out of any fence/prose, keeps only whitelisted fields, coerces each
/// proposed value by field kind, and drops a proposal that is empty, echoes the
/// current value, or (for stage) is out of the pipeline vocabulary. Returns [] when
/// nothing usable came back.
export function parseProjectProposals(
  raw: string,
  context: ProjectEnrichContext,
): ProjectProposal[] {
  const json = extractJsonArray(raw);
  if (json == null) return [];

  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: ProjectProposal[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const key = str(obj.field, 40) as EnrichField;
    const def = FIELD_BY_KEY.get(key);
    if (!def || seen.has(key)) continue;

    const current = context[key];
    const proposedValue = coerceProposedValue(key, obj.proposedValue);

    // Drop empties and echoes of what's already on record (case-insensitive).
    if (proposedValue === "") continue;
    if (proposedValue.toLowerCase() === current.trim().toLowerCase()) continue;

    const confidence =
      obj.confidence === "high" || obj.confidence === "low" ? obj.confidence : "medium";

    seen.add(key);
    // Values stay canonical (stage keeps its snake_case value) so the apply
    // action can re-validate them; the review UI formats stage labels itself.
    out.push({
      field: key,
      label: def.label,
      currentValue: current,
      proposedValue,
      reason: str(obj.reason, 300),
      confidence,
    });
  }
  return out;
}

/// PURE: the user prompt. Gives the project's current field values, then each
/// article, then the strict cite-or-drop contract and the exact JSON array shape
/// we consume.
export function buildEnrichPrompt(
  context: ProjectEnrichContext,
  articles: EnrichArticle[],
): string {
  const currentFields = [
    `Stage: ${context.stage === "" ? "unknown" : getStageDef(context.stage).label}`,
    context.county && `County: ${context.county}`,
    context.value && `Value ($): ${context.value}`,
    context.units && `Units / keys: ${context.units}`,
    context.sqft && `Square footage: ${context.sqft}`,
    context.prospectLead && `Developer / lead: ${context.prospectLead}`,
    context.description && `Description: ${context.description.slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const articleBlock = articles
    .map((a, i) => {
      const parts = [`${i + 1}. ${a.headline}`];
      if (a.summary) parts.push(`   ${a.summary.replace(/\n/g, " ").slice(0, 400)}`);
      return parts.join("\n");
    })
    .join("\n");

  const stageValues = PROJECT_STAGES.map((s) => s.value).join(", ");

  return `You are a real estate development analyst. Review the news coverage for one project, then suggest specific updates to its structured fields.

PROJECT: ${context.name}

CURRENT FIELDS:
${currentFields}

ARTICLES (${articles.length}):
${articleBlock}

FIELDS YOU MAY UPDATE:
- stage (one of exactly: ${stageValues}) — only if a milestone is reported (approval, permit, groundbreaking, financing close, opening).
- county — the New York county the project is in.
- value — total project value in whole US dollars (digits only).
- units — number of units or keys (integer).
- sqft — square footage (integer).
- prospectLead — the developer or lead organization's name (plain text).
- description — only if an article adds significant new information.

STRICT RULES — ACCURACY IS PARAMOUNT:
- Propose a change ONLY where an article explicitly and directly states it. Never infer, guess, or invent stages, dollar amounts, counties, or names.
- If the coverage is sparse, vague, or unrelated to a field, omit that field entirely.
- Include your confidence: high = explicitly stated, medium = strongly implied, low = reasonably inferred.
- If nothing in the articles relates to any field, return an empty array [].

Return ONLY a JSON array (no markdown, no prose), each element:
{"field":"stage","proposedValue":"under_construction","reason":"article states groundbreaking held","confidence":"high"}`;
}

const SYSTEM_PROMPT = `You are a real estate development data analyst. You ONLY extract facts explicitly stated in the articles provided. You NEVER invent, infer, or hallucinate stages, values, or names. If a field is not clearly supported by the coverage, you omit it. Accuracy is paramount — proposing nothing is always preferable to an unsupported change.`;

/// Propose field updates for a project from its news coverage. Ephemeral —
/// nothing is stored; the operator reviews and applies selected fields. Returns
/// [] when the model gives nothing usable.
export async function generateProjectEnrichment(
  context: ProjectEnrichContext,
  articles: EnrichArticle[],
): Promise<ProjectProposal[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildEnrichPrompt(context, articles) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseProjectProposals(text, context);
}
