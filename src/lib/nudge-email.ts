import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Nudge-email engine (ported from the prototype's "Nudge Email" draft on the
// member-deliverable panel, Coterie.html:6032). Given a single outstanding
// they-owe commitment — something a network contact owes the org — write the
// short, warm follow-up the host would send to check in on it. Like the other AI
// features this is the single server-only seam: prompt, model, and output shape
// live here so tenant data only leaves through a shape we control and the API key
// never reaches the browser. The draft is grounded strictly in the supplied
// commitment and is EPHEMERAL (nothing is stored).

export type NudgeEmailInput = {
  orgName: string;
  host: string;
  // Who owes the item and where they sit — the recipient of the nudge.
  contactName: string;
  companyName: string | null;
  // The outstanding commitment text and where it was made.
  commitment: string;
  meetingTitle: string | null;
  // Whole-day overdue count (positive) when the item has a past due date, else
  // null. Steers the model toward gentle urgency without inventing a deadline.
  overdueDays: number | null;
};

// The draft is BODY ONLY — no subject, no greeting, no sign-off — so the host can
// paste it straight into a reply thread. Rendered as an editable draft, never
// sent by the app.
export type NudgeEmailDraft = { body: string };

/// PURE: strip a wrapping markdown fence and trim the model's completion into the
/// body. Returns null when nothing usable is left (empty / whitespace-only) so the
/// caller can treat it as a failure.
export function parseNudgeEmail(raw: string): NudgeEmailDraft | null {
  let text = raw.trim();
  if (text === "") return null;

  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();

  if (text === "") return null;
  return { body: text };
}

// PURE: one context line, only when the value is present (keeps the prompt tight
// and stops the model treating an empty field as a fact to fill in).
function line(label: string, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "" : `  ${label}: ${v.slice(0, 220)}`;
}

/// PURE: the full user prompt handed to the model. Grounds the nudge in the one
/// outstanding commitment, names the host + org as the party waiting, and notes
/// how overdue it is when a due date is on record.
export function buildNudgeEmailPrompt(input: NudgeEmailInput): string {
  const { host, orgName, contactName, companyName, commitment, meetingTitle } =
    input;
  const overdue =
    input.overdueDays != null && input.overdueDays > 0
      ? `  Overdue by: ${input.overdueDays} day${input.overdueDays === 1 ? "" : "s"}`
      : "";

  const details = [
    line("Owed by", contactName),
    line("Company", companyName),
    line("Committed during", meetingTitle),
    overdue,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return `Write a short, friendly follow-up email from ${host} at ${orgName} to ${contactName} checking in on an outstanding item they owe.

RULES — follow exactly:
- Output ONLY the email body. No subject line. No greeting. No sign-off. Start with the first sentence.
- 3-4 sentences maximum.
- Sentence 1: reference the specific item you are checking in on — what was agreed, what is owed.
- Sentence 2: note warmly that ${host} and ${orgName} are looking forward to receiving it so things can keep moving. Keep this warm, not pressuring.
- Sentence 3: a simple, friendly ask — whenever they can get it over would be great.
- Sentence 4 (optional): offer to help if there is anything you can do on your end.
- Tone: collegial and warm — a friendly check-in from a trusted partner, never a demand.
- Ground every specific claim strictly in the details below — do NOT invent projects, meetings, or deadlines.
- No corporate filler ("I hope this finds you well", "I'm reaching out").

OUTSTANDING COMMITMENT:
  ${commitment}
${details}`;
}

const SYSTEM_PROMPT = `You draft short, warm follow-up "nudge" emails for the host of a private economic-development network, checking in on an outstanding item a network contact owes. Write in the host's first-person voice, collegial and warm — a friendly check-in from a trusted partner, never a demand. Ground every specific claim strictly in the supplied commitment — never invent meetings, projects, or deadlines. Output ONLY the email body: no subject, no greeting, no sign-off.`;

/// Draft the nudge email for the outstanding commitment. Ephemeral — nothing is
/// stored; the caller re-runs on demand. Returns null when the model gives
/// nothing usable.
export async function generateNudgeEmail(
  input: NudgeEmailInput,
): Promise<NudgeEmailDraft | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildNudgeEmailPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseNudgeEmail(text);
}
