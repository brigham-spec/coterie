import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Enrich-from-meetings engine (gap-audit cluster E, ported from the prototype's
// enrichProfileFromMeetings, Coterie.html:9522). Reads a company's recent synced
// meetings (title, summary, action items) and extracts the intro-engine-critical
// profile fields — what they're looking for, what they can offer, their sector —
// plus a short note to append. Like the other AI seams this is server-only: the
// prompt, model, and output shape live here. The result is EPHEMERAL and only the
// fields the operator explicitly selects are written (via applyMeetingEnrichment).
//
// Unlike the prototype we do NOT suggest new contacts here — unmatched meeting
// attendees are already surfaced by New Connections Detected, so this stays a
// pure profile-field enrichment and its apply path touches only the company row.

// The company being enriched, plus its current field values (so the model can
// tell what's already known and only surface genuinely new intelligence).
export type EnrichCompanyContext = {
  orgName: string;
  contactName: string;
  industry: string;
  lookingFor: string;
  canOffer: string;
};

// One meeting offered to the model as evidence.
export type EnrichMeeting = {
  date: string;
  title: string;
  summary: string;
  actionItems: string[];
};

// The extracted enrichment. Every field is a string; "" means "nothing new".
// `summary` is a one-line description of what was found (display-only, not written).
export type ProfileEnrichment = {
  summary: string;
  lookingFor: string;
  canOffer: string;
  industry: string;
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
/// JSON object out of any fence/prose and coerces each field. `currentIndustry`
/// is used to drop an industry suggestion that merely echoes what's already set
/// (case-insensitive) so the review only shows genuinely new sectors. Returns
/// null when nothing usable came back (every writable field empty).
export function parseProfileEnrichment(
  raw: string,
  currentIndustry: string,
): ProfileEnrichment | null {
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

  const enrichment: ProfileEnrichment = {
    summary: str(obj.summary, 300),
    lookingFor: str(obj.lookingFor, 200),
    canOffer: str(obj.canOffer, 200),
    industry,
    notesAppend: str(obj.notesAppend, 500),
  };

  const empty =
    enrichment.lookingFor === "" &&
    enrichment.canOffer === "" &&
    enrichment.industry === "" &&
    enrichment.notesAppend === "";
  if (empty) return null;
  return enrichment;
}

/// PURE: the user prompt. Gives the org's current field values as context, then
/// the recent meetings (freshest first), then asks for the exact JSON we consume.
export function buildEnrichMeetingsPrompt(
  context: EnrichCompanyContext,
  meetings: EnrichMeeting[],
): string {
  const blocks = meetings
    .map((m) => {
      const parts = [`[${m.date}] ${m.title || "Meeting"}`];
      if (m.summary) parts.push(`Summary: ${m.summary.replace(/\n/g, " ").slice(0, 400)}`);
      if (m.actionItems.length > 0)
        parts.push(`Action items: ${m.actionItems.join("; ").slice(0, 300)}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `Extract CRM profile data for a member organization from their recent meeting notes.

Member Organization: ${context.orgName}
${context.contactName ? `Primary Contact: ${context.contactName}\n` : ""}Current — Looking For: ${context.lookingFor || "(empty)"}
Current — Can Offer: ${context.canOffer || "(empty)"}
Current — Industry: ${context.industry || "(empty)"}

MEETING NOTES (most recent first):

${blocks}

Extract profile data for ${context.orgName}. Only surface what is clearly stated or strongly implied in the notes. Be specific and concrete — quote real needs, capabilities, and details. Prefer "" over inventing anything.

Return ONLY a valid JSON object (no markdown, no prose):
{"summary":"1 sentence on what the notes reveal","lookingFor":"what this org needs now — connections, capital, expertise, agencies. Specific. Max 200 chars. \"\" if nothing new","canOffer":"what this org provides — expertise, relationships, capabilities. Specific. Max 200 chars. \"\" if nothing new","industry":"primary sector, 3-5 words. \"\" if already set and accurate","notesAppend":"2-3 sentences of important current strategic context to append to notes. \"\" if nothing significant"}`;
}

const SYSTEM_PROMPT = `You extract CRM profile fields from a member's meeting notes. Return ONLY a single JSON object with the requested keys. Extract only information explicitly stated or strongly implied in the notes — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Extract profile enrichment from a company's recent meetings. Ephemeral —
/// nothing is stored; the operator reviews and applies selected fields. Returns
/// null when the model gives nothing usable.
export async function generateProfileEnrichment(
  context: EnrichCompanyContext,
  meetings: EnrichMeeting[],
): Promise<ProfileEnrichment | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildEnrichMeetingsPrompt(context, meetings) },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseProfileEnrichment(text, context.industry);
}
