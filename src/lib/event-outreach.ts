import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Event-outreach engine (gap-audit cluster D, ported from the prototype's
// generateInviteEmail / doGenerateOutreach, Coterie.html:7773). Given an event
// and one invited guest (a CRM contact, grounded in their company context), write
// a short, personal invitation email FROM the host TO that guest — the last-mile
// draft the host edits and sends. Like the other AI features this is the single
// server-only seam: prompt, model, and output shape live here so tenant data only
// leaves through a shape we control and the API key never reaches the browser. The
// draft is grounded strictly in the supplied context — no invented meetings,
// projects, or relationships — and is EPHEMERAL (nothing is stored).

// The event the invitation is for (factual, terse).
export type OutreachEvent = {
  name: string;
  date: string | null;
  venue: string | null;
  theme: string | null;
};

// The one guest being invited. Only descriptors we hold on their CRM profile —
// the engine cites these to make the email specific rather than generic.
export type OutreachGuest = {
  name: string;
  org: string | null;
  title: string | null;
  industry: string | null;
  seeking: string | null;
  brings: string | null;
  focusAreas: string[];
  recentTopics: string[];
};

export type OutreachInput = {
  orgName: string;
  host: string;
  event: OutreachEvent;
  guest: OutreachGuest;
  // Names of other guests already attending — the "you'll know someone" angle.
  confirmedGuests: string[];
};

/// PURE: tidy the model's raw completion into a sendable email body. Strips
/// markdown code fences, a stray leading "Subject:" line, and a single layer of
/// wrapping quotes the model sometimes adds, then trims. Returns "" for empty /
/// whitespace-only input so the caller can treat it as a failure.
export function cleanOutreachDraft(raw: string): string {
  let text = raw.trim();
  if (text === "") return "";

  // Remove a wrapping ``` / ```email code fence if the whole body is fenced.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();

  // Drop a leading "Subject: ..." line — we ask for body only, but guard anyway.
  text = text.replace(/^\s*subject:.*(?:\r?\n)+/i, "").trim();

  // Peel one layer of wrapping straight/smart quotes around the whole body.
  const wrapped = text.match(/^["“”']([\s\S]*)["“”']$/);
  if (wrapped) text = wrapped[1].trim();

  return text;
}

// PURE: one context line, only when the value is present (keeps the prompt tight
// and stops the model treating an empty field as a fact to fill in).
function line(label: string, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "" : `  ${label}: ${v.slice(0, 220)}`;
}

/// PURE: the full user prompt handed to the model. When the guest context is
/// sparse the model is told NOT to invent history, only to lean on the event and
/// the guest's known industry/role.
export function buildOutreachPrompt(input: OutreachInput): string {
  const { host, event, guest, confirmedGuests, orgName } = input;

  const guestLines = [
    line("Name", guest.name),
    line("Organization", guest.org),
    line("Title", guest.title),
    line("Industry", guest.industry),
    line("Seeking", guest.seeking),
    line("Brings", guest.brings),
    guest.focusAreas.length ? `  Focus areas: ${guest.focusAreas.join(", ")}` : "",
    ...guest.recentTopics.map((t) => `  Recent topic: ${t.replace(/\s+/g, " ").slice(0, 180)}`),
  ]
    .filter((l) => l !== "")
    .join("\n");

  const hasHistory = guest.recentTopics.length > 0 || Boolean(guest.seeking) || Boolean(guest.brings);
  const contextNote = hasHistory
    ? "NOTE: Real context on this guest is available below — use it. Cite what is present, do not go beyond it."
    : "NOTE: Limited history with this guest. Do NOT invent past meetings or conversations. Ground specificity in the event itself and their known industry/role.";

  const confirmedLine = confirmedGuests.length
    ? `\n  Others already attending: ${confirmedGuests.join(", ")}`
    : "";

  return `Write a personal invitation email from ${host} at ${orgName} to ${guest.name}${
    guest.org && guest.org !== guest.name ? ` at ${guest.org}` : ""
  } for the event "${event.name}" on ${event.date ?? "TBD"}${
    event.venue ? ` at ${event.venue}` : ""
  }.

RULES — follow exactly:
- Output ONLY the email body. No subject line. No greeting like "Hi ${guest.name}". No sign-off. Start with the first sentence.
- 4-5 sentences maximum.
- Sentence 1: name the event and one specific reason it exists that connects to their world.
- Sentence 2: why they specifically belong in the room. If real context is below, cite it. If context is sparse, connect to the event's theme and their industry — do NOT invent meetings or conversations.
- Sentence 3: if there's another attendee they'd value knowing, name them; otherwise reference the event's concrete value to someone in their position.
- Sentence 4: a brief, direct call to action.
- Do NOT be generic. Every sentence should contain something specific to this person.
- Tone: first-person ${host}, peer-to-peer, no corporate filler.
- IMPORTANT: ${contextNote}

EVENT:
  Name: ${event.name}
  Date: ${event.date ?? "TBD"}
  Venue: ${event.venue ?? "TBD"}
  Theme: ${event.theme ?? "Not specified"}${confirmedLine}

GUEST CONTEXT (use this to make the email specific):
${guestLines || "  (no additional profile on record)"}`;
}

const SYSTEM_PROMPT = `You draft short, personal invitation emails for the host of a private economic-development network. Write in the host's first-person voice, peer-to-peer, warm but direct. Ground every specific claim strictly in the supplied context — never invent meetings, projects, or relationships. Output only the email body: no subject, no greeting, no sign-off.`;

/// Draft the invitation email for one guest. Ephemeral — nothing is stored; the
/// caller re-runs on demand. Returns "" if the model gives nothing usable.
export async function generateOutreachEmail(input: OutreachInput): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildOutreachPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return cleanOutreachDraft(text);
}
