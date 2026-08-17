import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// Meeting action-item extraction (gap-audit cluster A, ported from the prototype's
// extract flow at Coterie.html:5344). Given a meeting's notes plus the people who
// could own a follow-up — the org's staff users and the meeting's matched attendee
// contacts — the model lifts the concrete commitments and attributes each to the
// best-matching name. Like the other AI features this is the single server-only
// seam: prompt, model, and output shape live here so tenant data only leaves
// through a shape we control and the API key never reaches the browser.
//
// This is deliberately EPHEMERAL — nothing is stored. The action_items table's
// owner-XOR CHECK requires exactly one owner (staff user XOR contact, never null),
// and Fireflies delivers items unattributed, so a human confirms/edits the owner
// before anything persists (see the meetings surface). Auto-committing a guessed
// owner would violate the project's "never silently assume" rule.

// Minimum length of usable meeting notes. Below this the notes are too thin to
// extract from — the caller short-circuits without a model call.
export const MIN_EXTRACTION_LENGTH = 20;

/// PURE: choose the best text to extract action items from. Fireflies delivers a
/// structured action_items text (real commitments, often owner-attributed) that
/// beats the thematic overview summary; prefer it when present and long enough,
/// otherwise fall back to the summary. Returns "" when neither is usable.
export function extractionNotes(m: {
  actionItemsText: string | null;
  summary: string | null;
}): string {
  const items = (m.actionItemsText ?? "").trim();
  if (items.length >= MIN_EXTRACTION_LENGTH) return items;
  return (m.summary ?? "").trim();
}

// A person who could own an action item. Both lists are supplied by the caller,
// already org-scoped (staff = org members, contacts = this meeting's attendees).
export type OwnerCandidate = { id: string; name: string };

// A proposed action item. ownerKind/ownerId is the resolution of the model's
// free-text ownerName against the supplied candidates: "staff" → a User.id,
// "contact" → a Contact.id, "unknown" → unresolved (id null), awaiting a human.
export type ActionItemCandidate = {
  text: string;
  ownerName: string;
  ownerKind: "staff" | "contact" | "unknown";
  ownerId: string | null;
};

/// PURE: map a resolved owner (a real staff user or contact + id) to the
/// action_items owner-XOR columns. Exactly one of ownerUserId/ownerContactId is
/// non-null, satisfying the CHECK — the single place that encoding lives, shared
/// by every write path that persists an owned item.
export function ownerColumns(
  ownerKind: "staff" | "contact",
  ownerId: string,
): { ownerUserId: string | null; ownerContactId: string | null } {
  return {
    ownerUserId: ownerKind === "staff" ? ownerId : null,
    ownerContactId: ownerKind === "contact" ? ownerId : null,
  };
}

// Split a name into lowercase word tokens for loose matching.
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// The one candidate in a pool whose name tokens are a superset of the needle's
// tokens (e.g. "john" matches "John Smith"; "john s" matches "John Smith"). Null
// when nothing matches OR when more than one candidate matches — an ambiguous
// partial ("john" with two Johns) is never guessed, it's left for a human.
function uniqueTokenMatch(
  needleTokens: readonly string[],
  pool: readonly OwnerCandidate[],
): OwnerCandidate | null {
  let hit: OwnerCandidate | null = null;
  for (const cand of pool) {
    const tokens = new Set(nameTokens(cand.name));
    if (needleTokens.every((t) => tokens.has(t))) {
      if (hit) return null; // ambiguous — more than one candidate matches
      hit = cand;
    }
  }
  return hit;
}

// Resolve a model-supplied owner name to a real candidate. Staff take precedence
// over contacts on a tie (a staff member logging their own follow-up is the more
// common case). First an exact case-insensitive full-name match; failing that, a
// loose match where the supplied name's tokens are a subset of a candidate's
// (e.g. a first name resolving to a full name), but only when that partial match
// is UNIQUE within the pool — an ambiguous partial stays unknown for a human.
function resolveOwner(
  ownerName: string,
  staff: readonly OwnerCandidate[],
  contacts: readonly OwnerCandidate[],
): { ownerKind: ActionItemCandidate["ownerKind"]; ownerId: string | null } {
  const needle = ownerName.trim().toLowerCase();
  if (needle === "") return { ownerKind: "unknown", ownerId: null };

  const staffExact = staff.find((s) => s.name.trim().toLowerCase() === needle);
  if (staffExact) return { ownerKind: "staff", ownerId: staffExact.id };
  const contactExact = contacts.find(
    (c) => c.name.trim().toLowerCase() === needle,
  );
  if (contactExact) return { ownerKind: "contact", ownerId: contactExact.id };

  const tokens = nameTokens(ownerName);
  if (tokens.length > 0) {
    const staffLoose = uniqueTokenMatch(tokens, staff);
    if (staffLoose) return { ownerKind: "staff", ownerId: staffLoose.id };
    const contactLoose = uniqueTokenMatch(tokens, contacts);
    if (contactLoose) return { ownerKind: "contact", ownerId: contactLoose.id };
  }
  return { ownerKind: "unknown", ownerId: null };
}

/// PURE: parse + validate the model's JSON array into proposed action items,
/// resolving each item's owner name against the supplied staff/contact candidates.
/// Drops entries with empty text. Robust to non-JSON / non-array responses
/// (returns []). Persists nothing — the caller reviews before saving.
export function parseActionItemCandidates(
  raw: string,
  staff: readonly OwnerCandidate[],
  contacts: readonly OwnerCandidate[],
): ActionItemCandidate[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ActionItemCandidate[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (text === "") continue;
    const ownerName = typeof o.owner === "string" ? o.owner.trim() : "";
    const { ownerKind, ownerId } = resolveOwner(ownerName, staff, contacts);
    out.push({ text, ownerName, ownerKind, ownerId });
  }
  return out;
}

const SYSTEM_PROMPT = `You extract action items from meeting notes for an economic-development organization. An action item is a concrete follow-up commitment someone made or was assigned — an introduction to make, a document to send, a call to schedule, research to do. Ignore general discussion, background, and pleasantries.

For each action item, attribute an owner: the person responsible for the follow-up. Choose the owner's name from the supplied STAFF and ATTENDEES lists whenever the notes make it clear who owns it. If the notes do not make the owner clear, use an empty string — do not guess a name that is not supported by the notes.

Ground every item in the supplied notes — do not invent commitments, people, or details that are not present. Keep each item's text to a short, specific imperative (e.g. "Introduce Jane Doe to Acme's CFO", "Send the IDA application draft").

Return ONLY a JSON array (no prose, no markdown code fences). Each element:
{"text": "<the action item>", "owner": "<a name from STAFF/ATTENDEES, or empty string>"}
If the notes contain no genuine action items, return [].`;

/// Extract proposed action items from a meeting's notes. Validates/resolves the
/// model's owners against the supplied candidates. Ephemeral — nothing is stored;
/// the caller presents these for human confirmation before persisting.
export async function generateActionItems(
  summary: string,
  staff: readonly OwnerCandidate[],
  contacts: readonly OwnerCandidate[],
): Promise<ActionItemCandidate[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `STAFF:\n${JSON.stringify(staff.map((s) => s.name))}\n\nATTENDEES:\n${JSON.stringify(contacts.map((c) => c.name))}\n\nMEETING NOTES:\n${summary}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseActionItemCandidates(text, staff, contacts);
}
