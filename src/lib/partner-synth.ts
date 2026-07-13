import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Partner-synthesis engine (slice P6a, ported from the prototype's Synthesize
// button in the Partnership section, Coterie.html:4653). Given a strategic
// partner's name, contact, relationship note, and website, Claude's web_search
// tool researches who they are and returns a structured partnership brief: a
// category, a who-they-are/why-strategic summary, and a suggested collaboration.
// Like the other AI seams this is the single server-only place the prompt, model,
// tool config, and output shape live so the Anthropic key never reaches the
// browser. The result is EPHEMERAL — the operator reviews and saves it via the
// Partnership form; nothing is written here.

// The partner being researched. `relationship` and `website` are the two hints
// the operator gives; either one is enough to run (the action enforces that).
export type PartnerSynthInput = {
  orgName: string;
  companyName: string;
  contactName: string;
  relationship: string;
  website: string;
};

// The synthesized partnership brief. Every field is a string; "" means the model
// had nothing for it. `summary` folds the model's who-they-are and why-strategic
// answers into the one Partnership Summary field the form writes.
export type PartnerSynthesis = {
  category: string;
  summary: string;
  collaboration: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string.
function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

/// PURE: parse the model's raw completion into a partnership brief. Pulls the
/// JSON object out of any fence/prose, folds `summary` + `relevanceToHVEDC` into
/// one summary block (matching the prototype), and coerces each field. Returns
/// null when nothing usable came back (category, summary, and collaboration all
/// empty).
export function parsePartnerSynthesis(raw: string): PartnerSynthesis | null {
  const json = extractJsonObject(raw);
  if (json == null) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const who = str(obj.summary, 300);
  const why = str(obj.relevanceToHVEDC, 300);
  const summary = [who, why].filter(Boolean).join("\n\n");

  const synthesis: PartnerSynthesis = {
    category: str(obj.category, 60),
    summary,
    collaboration: str(obj.suggestedCollaboration, 300),
  };

  if (
    synthesis.category === "" &&
    synthesis.summary === "" &&
    synthesis.collaboration === ""
  )
    return null;
  return synthesis;
}

/// PURE: the user prompt handed to the model (with the web_search tool). Grounds
/// the research in this specific partner and asks for the exact JSON we consume.
export function buildPartnerSynthPrompt(input: PartnerSynthInput): string {
  return `Analyze this strategic partner for ${input.orgName}, an economic-development network.

Organization: ${input.companyName}
Contact: ${input.contactName || "(unknown)"}
Relationship: ${input.relationship || "(not provided)"}
Website: ${input.website || "(not provided)"}

Research who this partner is and why they matter to an economic-development network. Ground everything in real, verifiable information from your search — do not invent facts.

Return ONLY a valid JSON object (no markdown, no prose):
{"category":"Government Agency|Political Office|Economic Dev Agency|Financial Institution|Utility|Industry/Trade Association|Professional Services|Nonprofit/Community|Academic|Other","summary":"2-3 sentences on who they are and what they do","relevanceToHVEDC":"1-2 sentences on why this is a strategic partner","suggestedCollaboration":"one sentence on what the network should be working on with them"}`;
}

const SYSTEM_PROMPT = `You research strategic partners for an economic-development network and return ONLY a single JSON object with the requested keys. Ground every answer in real information from your search — never invent facts. An empty string is always better than an invented one.`;

/// Research a strategic partner and synthesize a partnership brief. Ephemeral —
/// nothing is stored; the operator reviews and saves. Returns null when the model
/// gives nothing usable.
export async function generatePartnerSynthesis(
  input: PartnerSynthInput,
): Promise<PartnerSynthesis | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    tools: input.website
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
      : [],
    messages: [{ role: "user", content: buildPartnerSynthPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parsePartnerSynthesis(text);
}
