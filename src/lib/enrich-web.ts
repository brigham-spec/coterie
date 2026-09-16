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
// Alongside the profile scalars we also surface NEW people found on the web as
// proposed contacts (name / title / email / phone). Like the scalars they are
// ephemeral — the operator reviews and applies, and only then does the apply path
// create Contact rows. We do NOT propose projects here (those have their own
// surface). The existing contacts on file are passed in so we don't re-propose them.

// A person the web search surfaced who isn't already on the company's contact
// list. Every field is a bounded string; only `name` is required on apply.
export type WebContact = {
  name: string;
  title: string;
  email: string;
  phone: string;
};

// The company being enriched, plus its current field values and the public URLs
// to research (website / primary-contact name), so the model can tell what's
// already known and surface only genuinely new intelligence. `existingContacts`
// are the names already on file, so the model skips re-proposing them.
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
  existingContacts: string[];
};

// The extracted enrichment. Every scalar is a string; "" means "nothing new".
// `counties` is a comma-separated string here (split into String[] on apply).
// `summary` is a one-line description of what was found (display-only, not written).
// `contacts` are the newly-found people (empty when none).
export type WebEnrichment = {
  summary: string;
  lookingFor: string;
  canOffer: string;
  industry: string;
  counties: string;
  dealSize: string;
  agencyContacts: string;
  notesAppend: string;
  contacts: WebContact[];
};

// Cap on proposed contacts so a chatty search can't flood the review list.
const MAX_WEB_CONTACTS = 8;

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
  existingContactNames: string[] = [],
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
    contacts: parseWebContacts(obj.contacts, existingContactNames),
  };

  const empty =
    enrichment.lookingFor === "" &&
    enrichment.canOffer === "" &&
    enrichment.industry === "" &&
    enrichment.counties === "" &&
    enrichment.dealSize === "" &&
    enrichment.agencyContacts === "" &&
    enrichment.notesAppend === "" &&
    enrichment.contacts.length === 0;
  if (empty) return null;
  return enrichment;
}

/// PURE: coerce the model's `contacts` value into bounded WebContact rows. Each
/// needs a non-empty name; entries whose name already appears on file (or a
/// duplicate within the batch, case-insensitive) are dropped, and the list is
/// capped so a chatty search can't flood the review.
function parseWebContacts(
  value: unknown,
  existingContactNames: string[],
): WebContact[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(existingContactNames.map((n) => n.trim().toLowerCase()));
  const contacts: WebContact[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = str(e.name, 120);
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      name,
      title: str(e.title, 120),
      email: str(e.email, 200),
      phone: str(e.phone, 40),
    });
    if (contacts.length >= MAX_WEB_CONTACTS) break;
  }
  return contacts;
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
    context.existingContacts.length
      ? `Known Contacts: ${context.existingContacts.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const urls = context.website
    ? `Organization website: ${context.website}`
    : `Search for "${context.companyName}" and its primary contact by name.`;

  return `You are enriching a member profile for ${context.orgName}, an economic-development network.

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
- For "contacts", list key people at the organization found via search — leaders, decision-makers, or the right point of contact — EXCLUDING anyone under Known Contacts. Include title/email/phone only when verifiable. Use [] when no new people are found.
- Ground every value in a real, verifiable source from your search.

Return ONLY a valid JSON object (no markdown, no prose):
{"summary":"1 sentence on what the search revealed","lookingFor":"what they need — connections, capital, expertise, agencies. Specific. Max 200 chars. \\"\\" if nothing new","canOffer":"what they bring — expertise, relationships, capabilities. Specific. Max 200 chars. \\"\\" if nothing new","industry":"primary sector, 3-5 words. \\"\\" if already set and accurate","counties":"HV counties active in, comma-separated. \\"\\" if nothing new","dealSize":"typical deal size. \\"\\" if nothing new","agencyContacts":"NYS agency / government relationships found. \\"\\" if nothing new","notesAppend":"1-2 sentences of new strategic context to append to notes. \\"\\" if nothing significant","contacts":[{"name":"full name","title":"their role or \\"\\"","email":"email if found or \\"\\"","phone":"phone if found or \\"\\""}]}`;
}

const SYSTEM_PROMPT = `You enrich a member's profile using live web search. Return ONLY a single JSON object with the requested keys. Include only information found in real, verifiable sources — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Enrich a company's profile from a live web search. Ephemeral — nothing is
/// stored; the operator reviews and applies selected fields. Returns null when the
/// model gives nothing usable.
export async function generateWebEnrichment(
  context: EnrichWebContext,
): Promise<WebEnrichment | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: buildEnrichWebPrompt(context) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseWebEnrichment(text, context.industry, context.existingContacts);
}
