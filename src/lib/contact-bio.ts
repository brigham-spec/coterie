import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Contact-bio engine. Generates a short professional bio for a company contact,
// grounded in a live web search of their saved LinkedIn URL plus name / title /
// company (sibling to enrich-web, which enriches the company profile). Claude's
// web_search tool researches the person and writes a factual bio from what it
// finds. Server-only: the prompt, model, tool config, and output shape live here
// so the Anthropic key never reaches the browser. The result is EPHEMERAL — the
// operator reviews (and can edit) the proposed bio before it is saved via
// applyContactBio. Returns "" (parsed to null) when nothing verifiable is found.

// The contact being researched. `linkedin` is the primary anchor for the search;
// name / title / company disambiguate common names and ground the result.
export type ContactBioContext = {
  orgName: string;
  name: string;
  title: string;
  company: string;
  linkedin: string | null;
};

// One cap for the bio, shared by the parse bound, the persist bound
// (applyContactBio), and the prompt prose so they can never drift apart.
export const BIO_MAX = 800;

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" when it finds nothing; defends against the literal string "null" too.
function str(value: unknown, max = BIO_MAX): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

/// PURE: parse the model's raw completion into the bio string. Pulls the JSON
/// object out of any fence/prose (web-search replies are chatty), reads `bio`,
/// and returns null when nothing usable came back (empty bio).
export function parseContactBio(raw: string): string | null {
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

  const bio = str(obj.bio, BIO_MAX);
  return bio === "" ? null : bio;
}

/// PURE: the user prompt handed to the model (with the web_search tool). Gives
/// the known facts, the LinkedIn URL to anchor the search, then asks for the
/// exact JSON we consume — a factual, grounded bio or "" when nothing is found.
export function buildContactBioPrompt(context: ContactBioContext): string {
  const known = [
    `Name: ${context.name}`,
    context.title ? `Title: ${context.title}` : "",
    context.company ? `Company: ${context.company}` : "",
    context.linkedin ? `LinkedIn: ${context.linkedin}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const anchor = context.linkedin
    ? `Start from their LinkedIn profile: ${context.linkedin}`
    : `Search for "${context.name}"${context.company ? ` at ${context.company}` : ""} by name.`;

  return `You are writing a short professional bio for a contact in ${context.orgName}'s network, an economic-development network.

## KNOWN FACTS
${known}

## HOW TO RESEARCH
${anchor}

## TASK
Research this person using web search, then write a concise professional bio (2-4 sentences, max ${BIO_MAX} characters). Cover their current role, background, and relevant expertise or focus areas.
Rules:
- Ground every statement in a real, verifiable source from your search — never invent, infer, or embellish.
- Make sure you are describing the RIGHT person (match the company and title above); if you cannot confidently identify them, return "".
- Write in the third person, plain professional prose. No bullet points, no markdown.
- Return "" if you cannot find enough verifiable information for a factual bio.

Return ONLY a valid JSON object (no markdown, no prose):
{"bio":"2-4 sentence professional bio grounded in verifiable sources, or \\"\\" if nothing found"}`;
}

const SYSTEM_PROMPT = `You write short, factual professional bios using live web search. Return ONLY a single JSON object with a "bio" key. Include only information found in real, verifiable sources — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Generate a professional bio for a contact from a live web search. Ephemeral —
/// nothing is stored; the operator reviews and applies. Returns null when the
/// model gives nothing usable.
export async function generateContactBio(
  context: ContactBioContext,
): Promise<string | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: buildContactBioPrompt(context) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseContactBio(text);
}
