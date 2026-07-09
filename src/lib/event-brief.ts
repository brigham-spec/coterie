import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// Guest-brief engine (slice 11.7, ported from the prototype's showGuestBriefModal /
// generateOneBio). Given an event and its attending guests, write a short, warm
// professional bio for each — the host's crib sheet for who's in the room, shareable
// with other attendees. Like the other AI features this is the single server-only
// seam: prompt, model, and output shape live here so tenant data only leaves through
// a shape we control and the API key never reaches the browser. Bios are grounded
// strictly in the supplied context — no invented projects, roles, or history.

// The event framing the bios are written for (factual, terse).
export type BriefEvent = {
  name: string;
  date: string | null;
  venue: string | null;
  theme: string | null;
};

// One attending guest's public-facing context. Only descriptors safe to share with
// other attendees — no internal relationship notes.
export type GuestContext = {
  inviteeId: string;
  name: string;
  org: string | null;
  title: string | null;
  industry: string | null;
  seeking: string | null;
  brings: string | null;
  focusAreas: string[];
};

// A generated bio keyed back to its invitee.
export type GuestBrief = { inviteeId: string; name: string; bio: string };

function coerceBrief(
  item: unknown,
  validIds: ReadonlySet<string>,
  nameById: ReadonlyMap<string, string>,
): GuestBrief | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const inviteeId = typeof o.inviteeId === "string" ? o.inviteeId : "";
  // Reject anything the model invented that isn't a supplied guest.
  if (!validIds.has(inviteeId)) return null;
  const bio = typeof o.bio === "string" ? o.bio.trim() : "";
  if (bio === "") return null;
  return { inviteeId, name: nameById.get(inviteeId) ?? "", bio };
}

/// PURE: parse + validate the model's JSON array into per-guest bios, dropping any
/// entry whose inviteeId isn't a supplied guest (no hallucinated guests) or whose
/// bio is empty. Names are re-attached from the supplied roster, not the model's
/// output. Robust to non-JSON / non-array responses.
export function parseGuestBriefs(
  raw: string,
  guests: readonly GuestContext[],
): GuestBrief[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const validIds = new Set(guests.map((g) => g.inviteeId));
  const nameById = new Map(guests.map((g) => [g.inviteeId, g.name]));

  const out: GuestBrief[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const b = coerceBrief(item, validIds, nameById);
    // One bio per guest — keep the first, ignore duplicates.
    if (b && !seen.has(b.inviteeId)) {
      seen.add(b.inviteeId);
      out.push(b);
    }
  }
  return out;
}

const SYSTEM_PROMPT = `You write short, warm, professional guest bios for the host of a private economic-development event to share with attendees. For each GUEST supplied, write a bio of 2-3 sentences:
- Sentence 1: who they are and what they do (organization, role, sector).
- Sentence 2: what they are currently focused on or working on — be specific, citing what is present in the context.
- Sentence 3 (optional): what they are looking for, or the value they bring to the room. Include only if the context makes it clear.

Ground every claim strictly in the supplied context — do not invent organizations, titles, projects, or history that is not present. Tone: warm and professional, suitable for a printed guest list. Not a LinkedIn summary; no headers, labels, or quotes inside the bio.

Return ONLY a JSON array (no prose, no markdown code fences). Each element:
{"inviteeId": "<one of the supplied guest ids>", "bio": "<the 2-3 sentence bio>"}
inviteeId MUST be one of the supplied guest ids. Write one bio per guest.`;

/// Write a bio for each attending guest. Validates the model's output against the
/// supplied guest ids (no hallucinated guests). Ephemeral — nothing is stored; the
/// caller re-runs on demand.
export async function generateGuestBriefs(
  event: BriefEvent,
  host: string,
  guests: GuestContext[],
): Promise<GuestBrief[]> {
  if (guests.length === 0) return [];

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `HOST: ${host}\n\nEVENT:\n${JSON.stringify(event, null, 2)}\n\nGUESTS:\n${JSON.stringify(guests, null, 2)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseGuestBriefs(text, guests);
}
