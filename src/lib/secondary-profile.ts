import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Secondary-profile synthesis engine (company-profile enrichment slice). A member
// company often has ADDITIONAL business lines or capabilities beyond its primary
// profile — revealed by the other companies it is affiliated with and by the
// documents uploaded to its file. This engine reads those affiliations + document
// summaries and synthesizes a compact secondary triplet (industry / can-offer /
// looking-for) that the intro engine treats as SUPPORTING signal, weighted below
// the primary profile. Server-only: the prompt, model, and output shape live here
// so the Anthropic key never reaches the browser. The result is EPHEMERAL — the
// operator reviews and applies only the fields they select (via
// applySecondaryProfile). NO web tool: this purely synthesizes supplied data.

// What the model is handed: the company's primary profile (so it only surfaces
// what's genuinely ADDITIONAL), plus its affiliations and document summaries.
export type SecondaryProfileContext = {
  orgName: string;
  companyName: string;
  primaryIndustry: string;
  primaryLookingFor: string;
  primaryCanOffer: string;
  affiliations: Array<{
    name: string;
    role: string;
    industry: string;
    canOffer: string;
    lookingFor: string;
  }>;
  documentSummaries: string[];
};

// The synthesized secondary triplet. Every field is a bounded string; "" means
// "nothing additional". `null` from the parser means nothing synthesizable at all.
export type SecondaryProfile = {
  secondaryIndustry: string;
  secondaryCanOffer: string;
  secondaryLookingFor: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" for empty, but defends against the literal string "null" too.
function str(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

/// PURE: parse the model's raw completion into a structured secondary profile.
/// Pulls the JSON object out of any fence/prose and coerces each field. Returns
/// null when nothing usable came back (all three fields empty).
export function parseSecondaryProfile(raw: string): SecondaryProfile | null {
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

  const profile: SecondaryProfile = {
    secondaryIndustry: str(obj.secondaryIndustry, 120),
    secondaryCanOffer: str(obj.secondaryCanOffer, 300),
    secondaryLookingFor: str(obj.secondaryLookingFor, 300),
  };

  const empty =
    profile.secondaryIndustry === "" &&
    profile.secondaryCanOffer === "" &&
    profile.secondaryLookingFor === "";
  if (empty) return null;
  return profile;
}

/// PURE: the user prompt. Lays out the primary profile, the affiliations, and the
/// document summaries, then asks for the exact JSON we consume — ONLY the
/// additional business lines / capabilities the affiliations + documents reveal
/// that are NOT already the company's primary profile.
export function buildSecondaryProfilePrompt(
  context: SecondaryProfileContext,
): string {
  const primary = [
    `Company: ${context.companyName}`,
    context.primaryIndustry ? `Primary industry: ${context.primaryIndustry}` : "",
    context.primaryCanOffer ? `Primary can offer: ${context.primaryCanOffer}` : "",
    context.primaryLookingFor
      ? `Primary looking for: ${context.primaryLookingFor}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const affiliations =
    context.affiliations.length > 0
      ? context.affiliations
          .map((a, i) => {
            const parts = [
              a.name,
              a.role ? `role: ${a.role}` : "",
              a.industry ? `industry: ${a.industry}` : "",
              a.canOffer ? `can offer: ${a.canOffer}` : "",
              a.lookingFor ? `looking for: ${a.lookingFor}` : "",
            ].filter(Boolean);
            return `${i + 1}. ${parts.join(" — ")}`;
          })
          .join("\n")
      : "(none on file)";

  const documents =
    context.documentSummaries.length > 0
      ? context.documentSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none on file)";

  return `You are synthesizing a SECONDARY profile for ${context.companyName}, a member of ${context.orgName}, an economic-development network.

## PRIMARY PROFILE (already captured — do NOT repeat)
${primary}

## AFFILIATIONS (other companies / hats this member wears)
${affiliations}

## UPLOADED DOCUMENT SUMMARIES
${documents}

## TASK
From the affiliations and documents above, synthesize ONLY the ADDITIONAL business lines, capabilities, or needs that are NOT already covered by the primary profile. This secondary signal helps the network see the full range of what this member can do and what they want — beyond their main line of business.
Rules:
- Only include what the affiliations/documents genuinely reveal. Use "" for any field with nothing additional.
- Do NOT restate the primary profile. If the affiliations/documents only echo it, return "" for every field.
- Ground every value in the supplied affiliations/documents — never invent or infer beyond them.
- Be concise and specific.

Return ONLY a valid JSON object (no markdown, no prose):
{"secondaryIndustry":"additional sectors/business lines, comma-separated, 3-8 words. \\"\\" if nothing additional","secondaryCanOffer":"additional capabilities/resources the affiliations+documents reveal. Specific. Max 300 chars. \\"\\" if nothing additional","secondaryLookingFor":"additional needs the affiliations+documents reveal. Specific. Max 300 chars. \\"\\" if nothing additional"}`;
}

const SYSTEM_PROMPT = `You synthesize a company's SECONDARY profile from its affiliations and documents. Return ONLY a single JSON object with the requested keys. Include only what the supplied material genuinely reveals beyond the primary profile — never invent, infer, or hallucinate. An empty string is always better than invented or duplicated content.`;

/// Synthesize a company's secondary profile from its affiliations + document
/// summaries. Ephemeral — nothing is stored; the operator reviews and applies
/// selected fields. Returns null when the model gives nothing usable.
export async function generateSecondaryProfile(
  context: SecondaryProfileContext,
): Promise<SecondaryProfile | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildSecondaryProfilePrompt(context) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseSecondaryProfile(text);
}
