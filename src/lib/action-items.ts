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

// Resolve a model-supplied owner name to a real candidate. Staff take precedence
// over contacts on a tie (a staff member logging their own follow-up is the more
// common case), matching case-insensitively on the trimmed full name.
function resolveOwner(
  ownerName: string,
  staff: readonly OwnerCandidate[],
  contacts: readonly OwnerCandidate[],
): { ownerKind: ActionItemCandidate["ownerKind"]; ownerId: string | null } {
  const needle = ownerName.trim().toLowerCase();
  if (needle !== "") {
    const staffHit = staff.find((s) => s.name.trim().toLowerCase() === needle);
    if (staffHit) return { ownerKind: "staff", ownerId: staffHit.id };
    const contactHit = contacts.find(
      (c) => c.name.trim().toLowerCase() === needle,
    );
    if (contactHit) return { ownerKind: "contact", ownerId: contactHit.id };
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
