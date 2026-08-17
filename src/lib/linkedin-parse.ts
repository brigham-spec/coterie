import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// LinkedIn-profile parser (gap-audit cluster E, ported from the prototype's
// showLinkedInParseModal, Coterie.html:16403). Given raw text pasted from a
// LinkedIn profile page, extract the structured prospect fields the operator
// would otherwise re-type — org, contact, title, what they seek / can offer —
// so a new prospect record can be pre-filled for review. Like the other AI
// features this is the single server-only seam: prompt, model, and output shape
// live here so the API key never reaches the browser. The parse is EPHEMERAL:
// nothing is stored until the operator reviews the fields and saves.

// The extracted profile. Every field is a plain string (empty when the model had
// nothing on record); `industry` is a loose category hint (free text on save).
export type LinkedInProfile = {
  name: string;
  org: string;
  title: string;
  industry: string;
  email: string;
  phone: string;
  linkedin: string;
  website: string;
  location: string;
  lookingFor: string;
  canOffer: string;
  notes: string;
};

// PURE: coerce any JSON value to a trimmed string, capped so a runaway field
// can't bloat the review form. Non-strings (numbers, null) become "".
function str(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/// PURE: pull the structured profile out of the model's raw completion. Strips a
/// wrapping fence / surrounding prose via extractJsonObject, parses the object,
/// and coerces each field to a string. Returns null when nothing usable came
/// back (unparseable, or neither a contact name nor an organization) so the
/// caller can treat it as a failure.
export function parseLinkedInProfile(raw: string): LinkedInProfile | null {
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

  const profile: LinkedInProfile = {
    name: str(obj.name, 120),
    org: str(obj.org, 160),
    title: str(obj.title, 160),
    industry: str(obj.industry, 60),
    email: str(obj.email, 160),
    phone: str(obj.phone, 40),
    linkedin: str(obj.linkedin, 300),
    website: str(obj.website, 300),
    location: str(obj.location, 120),
    lookingFor: str(obj.lookingFor),
    canOffer: str(obj.canOffer),
    notes: str(obj.notes),
  };

  // Nothing to seed a record with — refuse rather than pre-fill an empty form.
  if (profile.name === "" && profile.org === "") return null;
  return profile;
}

// Cap the per-tenant industry hints so a large network can't bloat the prompt.
const MAX_INDUSTRY_HINTS = 30;

/// PURE: sanitize, trim, drop blanks, and de-dupe case-insensitively (first
/// wins) the tenant's industry categories, capped so the hint stays bounded.
/// Industries are operator/CSV/AI free text, so strip the characters that would
/// corrupt the prompt's JSON skeleton or the pipe-separated list (`"`, `|`,
/// newlines) and bound each hint's length.
function cleanIndustryHints(categories: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of categories) {
    const c = raw.replace(/["|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (c === "") continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_INDUSTRY_HINTS) break;
  }
  return out;
}

/// PURE: the user prompt handed to the model. Asks for a single JSON object with
/// the exact keys we consume, and appends the pasted profile (bounded — a pasted
/// page is often long and mostly boilerplate). The industry hint is PER-TENANT:
/// when the caller supplies this network's existing industries, the model picks
/// the closest one (or "Other"); with none on file (a fresh network) it falls
/// back to a free-text label rather than a hardcoded, org-specific enum.
export function buildLinkedInPrompt(
  profileText: string,
  categories: readonly string[] = [],
): string {
  const hints = cleanIndustryHints(categories);
  const industryValue = hints.length > 0 ? [...hints, "Other"].join("|") : "";
  const industryRule =
    hints.length > 0
      ? `- industry: choose the single closest category from the pipe-separated list in the "industry" slot above; use "Other" only if none fit.`
      : `- industry: a short 1-3 word industry label for this person's company.`;

  return `Parse this LinkedIn profile and return ONLY a valid JSON object — no markdown, no prose.

Structure (use "" for anything not present):
{"name":"","org":"","title":"","industry":"${industryValue}","email":"","phone":"","linkedin":"","website":"","location":"","lookingFor":"","canOffer":"","notes":"2-3 sentence summary of who they are and what they do"}

Rules:
- name is the person; org is their current company/employer.
${industryRule}
- lookingFor / canOffer: infer what this person or org is seeking and what they bring, only if the profile supports it — otherwise "".
- Do NOT invent contact details, projects, or facts not present in the text.

PROFILE:
${profileText.slice(0, 6000)}`;
}

const SYSTEM_PROMPT = `You extract structured profile fields from pasted LinkedIn profile text for an economic-development network. Return ONLY a single JSON object with the requested keys. Ground every field strictly in the supplied text — never invent contact details, employers, or facts. Use "" for anything the profile does not state.`;

/// Parse the pasted profile into structured fields. Ephemeral — nothing is
/// stored; the operator reviews and saves. Returns null when the model gives
/// nothing usable.
export async function generateLinkedInProfile(
  profileText: string,
  categories: readonly string[] = [],
): Promise<LinkedInProfile | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildLinkedInPrompt(profileText, categories) },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseLinkedInProfile(text);
}
