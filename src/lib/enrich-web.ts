import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Enrich-from-web engine (gap-audit cluster E, ported from the prototype's
// enrichProfileFromWeb, Coterie.html:9588). Sibling to enrich-from-meetings: the
// same review-then-apply profile enrichment, but grounded in a live web search of
// the member's own website / name rather than their meeting notes. Claude's
// web_search tool researches the organisation and returns only genuinely new or
// better values for the intro-engine-critical fields — what they're looking for,
// what they can offer, sector, counties, deal size, agency contacts — plus a note
// to append. Server-only: the prompt, model, tool config, and output shape live
// here so the Anthropic key never reaches the browser. The result is EPHEMERAL
// and only the fields the operator selects are written (via applyWebEnrichment).
//
// Like enrich-from-meetings we do NOT propose new contacts or projects here; those
// are relation writes with their own surfaces. This stays a pure profile-scalar
// enrichment and its apply path touches only the company row.

// The company being enriched, plus its current field values and the public URLs
// to research (website / primary-contact name), so the model can tell what's
// already known and surface only genuinely new intelligence.
export type EnrichWebContext = {
  orgName: string;
  companyName: string;
  contactName: string;
  industry: string;
  counties: string[];
  website: string | null;
  lookingFor: string;
  canOffer: string;
  dealSize: string;
  agencyContacts: string;
};

// The extracted enrichment. Every field is a string; "" means "nothing new".
// `counties` is a comma-separated string here (split into String[] on apply).
// `summary` is a one-line description of what was found (display-only, not written).
export type WebEnrichment = {
  summary: string;
  lookingFor: string;
  canOffer: string;
  industry: string;
  counties: string;
  dealSize: string;
  agencyContacts: string;
  notesAppend: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" for empty, but defends against the literal string "null" too.
function str(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

/// PURE: parse the model's raw completion into a structured enrichment. Pulls the
/// JSON object out of any fence/prose (web-search replies are chatty) and coerces
/// each field. `currentIndustry` is used to drop an industry suggestion that
/// merely echoes what's already set (case-insensitive) so the review only shows a
/// genuinely new sector. Returns null when nothing usable came back (every
/// writable field empty).
export function parseWebEnrichment(
  raw: string,
  currentIndustry: string,
): WebEnrichment | null {
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

  const industryRaw = str(obj.industry, 80);
  const industry =
    industryRaw !== "" &&
    industryRaw.toLowerCase() !== currentIndustry.trim().toLowerCase()
      ? industryRaw
      : "";

  const enrichment: WebEnrichment = {
    summary: str(obj.summary, 300),
    lookingFor: str(obj.lookingFor, 200),
    canOffer: str(obj.canOffer, 200),
    industry,
    counties: str(obj.counties, 200),
    dealSize: str(obj.dealSize, 100),
    agencyContacts: str(obj.agencyContacts, 300),
    notesAppend: str(obj.notesAppend, 500),
  };

  const empty =
    enrichment.lookingFor === "" &&
    enrichment.canOffer === "" &&
    enrichment.industry === "" &&
    enrichment.counties === "" &&
    enrichment.dealSize === "" &&
    enrichment.agencyContacts === "" &&
    enrichment.notesAppend === "";
  if (empty) return null;
  return enrichment;
}

/// PURE: the user prompt handed to the model (with the web_search tool). Gives the
/// current field values as context, the public URLs to research, then asks for the
/// exact JSON we consume — only NEW or BETTER values, notes to APPEND.
export function buildEnrichWebPrompt(context: EnrichWebContext): string {
  const known = [
    `Organization: ${context.companyName}`,
    context.contactName ? `Primary Contact: ${context.contactName}` : "",
    context.industry ? `Industry: ${context.industry}` : "",
    context.counties.length ? `Counties: ${context.counties.join(", ")}` : "",
    context.website ? `Website: ${context.website}` : "",
    context.dealSize ? `Deal Size: ${context.dealSize}` : "",
    context.lookingFor ? `Looking For: ${context.lookingFor}` : "",
    context.canOffer ? `Can Offer: ${context.canOffer}` : "",
    context.agencyContacts ? `Agency Contacts: ${context.agencyContacts}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const urls = context.website
    ? `Organization website: ${context.website}`
    : `Search for "${context.companyName}" and its primary contact by name.`;

  return `You are enriching a CRM profile for ${context.orgName}, an economic-development network.

## EXISTING PROFILE
${known}

## URLs TO RESEARCH
${urls}

## TASK
Research this member using web search. Then return a JSON object with ONLY fields that you can improve or add to what's already known.
Rules:
- Only include fields with NEW or BETTER information than what's already in the profile.
- Do NOT repeat information already captured; prefer "" over inventing anything.
- For "counties", list the Hudson Valley, NY counties they are active in (comma-separated).
- For "notesAppend", APPEND new context (1-2 sentences) — do not restate existing notes.
- Ground every value in a real, verifiable source from your search.

Return ONLY a valid JSON object (no markdown, no prose):
{"summary":"1 sentence on what the search revealed","lookingFor":"what they need — connections, capital, expertise, agencies. Specific. Max 200 chars. \\"\\" if nothing new","canOffer":"what they bring — expertise, relationships, capabilities. Specific. Max 200 chars. \\"\\" if nothing new","industry":"primary sector, 3-5 words. \\"\\" if already set and accurate","counties":"HV counties active in, comma-separated. \\"\\" if nothing new","dealSize":"typical deal size. \\"\\" if nothing new","agencyContacts":"NYS agency / government relationships found. \\"\\" if nothing new","notesAppend":"1-2 sentences of new strategic context to append to notes. \\"\\" if nothing significant"}`;
}

const SYSTEM_PROMPT = `You enrich a member's CRM profile using live web search. Return ONLY a single JSON object with the requested keys. Include only information found in real, verifiable sources — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Enrich a company's profile from a live web search. Ephemeral — nothing is
/// stored; the operator reviews and applies selected fields. Returns null when the
/// model gives nothing usable.
export async function generateWebEnrichment(
  context: EnrichWebContext,
): Promise<WebEnrichment | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: buildEnrichWebPrompt(context) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseWebEnrichment(text, context.industry);
}
