import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// AI guest-list curation (ported from the prototype's "AI Suggest Guest List",
// Coterie.html:8210). Given an event's theme and target size plus the tenant's
// network contacts who aren't yet on the list — each with their company's
// profile (what they seek/offer) and whether their company has ever been invited
// anywhere — Claude picks the best-fitting guests and gives a one-line reason for
// each. Unlike the ephemeral brief/ideas/outreach seams, the caller PERSISTS the
// result: each pick becomes an EventInvitee with the reason stored as its note.
//
// Like every AI feature this is the single server-only seam: prompt, model, and
// output shape live here so tenant data only leaves through a shape we control
// and the API key never reaches the browser. Picks are grounded strictly in the
// supplied candidates — any contactId the model invents is dropped, and the name
// is re-attached from the candidate roster, never trusted from the output.

// One contact the curation may pick. `neverInvited` flags contacts whose company
// has never appeared on any event guest list — the engine prioritises them.
export type GuestCandidate = {
  contactId: string;
  name: string;
  company: string | null;
  industry: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  tags: string[];
  neverInvited: boolean;
};

export type GuestMeeting = { title: string; summary: string | null };

export type SuggestGuestInput = {
  orgName: string;
  event: {
    name: string;
    typeLabel: string;
    theme: string | null;
    capacity: number | null;
  };
  alreadyInvited: string[];
  candidates: GuestCandidate[];
  recentMeetings: GuestMeeting[];
};

// A picked guest. `contactId` is validated against the supplied candidates;
// `name` is re-attached from that roster, never trusted from the model's output.
export type SuggestedGuest = { contactId: string; name: string; reason: string };

// When the event has no capacity set, aim for this many picks (prototype default).
const DEFAULT_TARGET = 12;
// Defensive cap on how many picks we accept back regardless of target.
const MAX_PICKS = 40;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/// PURE: parse + validate the model's JSON array into guest picks. Each pick's
/// contactId must be a supplied candidate (invented ids dropped, name re-attached
/// from the roster); duplicates are collapsed and the result is capped to
/// MAX_PICKS. Robust to non-JSON / non-array responses.
export function parseGuestSuggestions(
  raw: string,
  candidates: readonly GuestCandidate[],
): SuggestedGuest[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const nameById = new Map(candidates.map((c) => [c.contactId, c.name]));

  const out: SuggestedGuest[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const contactId = str(o.contactId);
    const name = nameById.get(contactId);
    if (name === undefined || seen.has(contactId)) continue;
    seen.add(contactId);
    out.push({ contactId, name, reason: str(o.reason) });
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

// PURE: one candidate's profile line for the prompt (terse, id-tagged so the
// model can reference it back in its picks).
function candidateLine(c: GuestCandidate): string {
  const parts = [`[ID:${c.contactId}] ${c.name}`];
  if (c.company) parts.push(c.company);
  if (c.industry) parts.push(c.industry);
  if (c.tags.length) parts.push(`Tags: ${c.tags.join(", ")}`);
  if (c.lookingFor) parts.push(`Needs: ${c.lookingFor.slice(0, 120)}`);
  if (c.canOffer) parts.push(`Offers: ${c.canOffer.slice(0, 120)}`);
  if (c.neverInvited) parts.push("NEVER INVITED");
  return parts.join(" | ");
}

// PURE: the full user prompt handed to the model.
function buildPrompt(input: SuggestGuestInput): string {
  const target = input.event.capacity ?? DEFAULT_TARGET;

  const candidates =
    input.candidates.map(candidateLine).join("\n") ||
    "(no un-invited network contacts)";

  const alreadyInvited = input.alreadyInvited.length
    ? input.alreadyInvited.join(", ")
    : "none yet";

  const neverInvited = input.candidates.filter((c) => c.neverInvited);
  const neverInvitedBlock = neverInvited.length
    ? `\n\nCONTACTS WHOSE COMPANY HAS NEVER BEEN INVITED TO ANY EVENT (prioritise if they fit):\n${neverInvited
        .map((c) => `- [ID:${c.contactId}] ${c.name}${c.company ? ` (${c.company})` : ""}`)
        .join("\n")}`
    : "";

  const meetings = input.recentMeetings.length
    ? `\n\nRECENT MEETING INTELLIGENCE (identify contacts with an active, relevant need):\n${input.recentMeetings
        .map(
          (m) =>
            `- ${m.title}${m.summary ? `: ${m.summary.replace(/\s+/g, " ").slice(0, 200)}` : ""}`,
        )
        .join("\n")}`
    : "";

  return `You are curating the guest list for a ${input.event.typeLabel} hosted by ${input.orgName}.

Event: "${input.event.name}"
Theme: ${input.event.theme || "Member networking and relationship building"}
Target size: about ${target} guests
Already invited: ${alreadyInvited}${neverInvitedBlock}${meetings}

AVAILABLE CONTACTS (not yet invited):
${candidates}

Select the best up to ${target} candidates. Prioritise: specific fit with the event's theme, contacts whose company has never been invited, and active relevance from the meeting intelligence. Use ONLY the [ID:...] contact ids listed above.

Return ONLY a valid JSON array — no prose, no markdown code fences:
[{"contactId":"<id from above>","reason":"<one specific sentence on why they fit this event>"}]`;
}

const SYSTEM_PROMPT = `You are a precise event host curating a guest list for an economic-development membership network. Pick guests only from the supplied contacts (reference them by their [ID:...] contact id) and give each a specific, evidence-grounded reason. Never invent contacts.`;

/// Curate a guest list for an event. Validates the model's picks against the
/// supplied candidate roster (no invented guests). The caller persists each pick
/// as an EventInvitee with the reason as its note.
export async function generateGuestSuggestions(
  input: SuggestGuestInput,
): Promise<SuggestedGuest[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseGuestSuggestions(text, input.candidates);
}
