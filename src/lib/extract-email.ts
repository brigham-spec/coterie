import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Email-thread extraction engine (member-profile parity, ported from the
// prototype's showEmailPasteForMember, Coterie.html:16686). The operator pastes a
// raw email thread on a company profile; Claude reads it and returns the same
// structured shape the org-level Zapier sync lands in the EmailMessage ledger —
// subject, a short summary, projects/action-items it spotted, sentiment, the
// sender, and the date. Server-only: the prompt, model, and output shape live here
// so the Anthropic key never reaches the browser. The result is EPHEMERAL — the
// operator reviews it, then saveEmailMessage persists ONE EmailMessage row scoped
// to this company (a manual sibling to the synced rows, keyed manual:<uuid>).
//
// This is the manual analog to the background email sync, exactly as manual
// meeting-logging is the analog to the Fireflies sync. We do NOT match against
// other members or split action items per person here (the flat EmailMessage model
// is single-company); the thread is anchored to the profile it was pasted on.

// The company the thread was pasted on, plus its contact names, so the model can
// tell who the external sender is and ground the summary in a known relationship.
export type EmailExtractionContext = {
  orgName: string;
  contactNames: string[];
};

// The extracted message. Every field is a string; "" means "nothing found". The
// shape mirrors the EmailMessage columns: `projects` is comma-separated and
// `actionItems` is semicolon-separated so a manual row renders identically to a
// synced one on the Email Intelligence surface.
export type EmailExtraction = {
  subject: string;
  summary: string;
  projects: string;
  actionItems: string;
  sentiment: string;
  emailDate: string;
  fromName: string;
  fromEmail: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" for empty, but defends against the literal string "null" too.
function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

// PURE: normalise the model's sentiment to the vocabulary the Email surface tones
// on (positive → teal, negative → red, else slate). Anything else collapses to "".
function sentiment(value: unknown): string {
  const v = str(value, 20).toLowerCase();
  return v === "positive" || v === "negative" || v === "neutral" ? v : "";
}

/// PURE: parse the model's raw completion into a structured message. Pulls the
/// JSON object out of any fence/prose and coerces each field. Returns null when
/// nothing usable came back (no subject AND no summary) so the caller can treat it
/// as "couldn't read this thread".
export function parseEmailExtraction(raw: string): EmailExtraction | null {
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

  const extraction: EmailExtraction = {
    subject: str(obj.subject, 200),
    summary: str(obj.summary, 1000),
    projects: str(obj.projects, 300),
    actionItems: str(obj.actionItems, 1000),
    sentiment: sentiment(obj.sentiment),
    emailDate: str(obj.emailDate, 40),
    fromName: str(obj.fromName, 120),
    fromEmail: str(obj.fromEmail, 200),
  };

  if (extraction.subject === "" && extraction.summary === "") return null;
  return extraction;
}

/// PURE: the user prompt handed to the model. Gives the member and its contacts as
/// context (so the model can name the external sender), then asks for the exact
/// JSON we consume. The thread body is bounded to keep the request small.
export function buildEmailPrompt(
  context: EmailExtractionContext,
  thread: string,
): string {
  const contacts = context.contactNames.filter(Boolean).slice(0, 8).join(", ");
  return `Read this email thread for the member profile of ${context.orgName} and extract structured CRM intelligence.

Known contacts at this member: ${contacts || "(none on file)"}

Focus on the MOST RECENT message for current status. Quote real project names, dates, and follow-ups. Prefer "" over inventing anything.

Return ONLY a valid JSON object (no markdown, no prose):
{"subject":"thread subject, strip RE:/FW: prefixes","summary":"2-3 sentence summary of where things stand. \\"\\" if unreadable","projects":"comma-separated project or deal names mentioned. \\"\\" if none","actionItems":"semicolon-separated follow-ups or next steps. \\"\\" if none","sentiment":"positive, neutral, or negative — the member's tone. \\"\\" if unclear","emailDate":"date of the most recent message, YYYY-MM-DD. \\"\\" if not stated","fromName":"name of the external sender. \\"\\" if unclear","fromEmail":"email address of the external sender. \\"\\" if not present"}

EMAIL THREAD:
${thread.slice(0, 6000)}`;
}

const SYSTEM_PROMPT = `You analyse a pasted email thread for a CRM. Return ONLY a single JSON object with the requested keys. Extract only information explicitly present in the thread — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Extract structured intelligence from a pasted email thread. Ephemeral —
/// nothing is stored; the operator reviews and saves. Returns null when the model
/// gives nothing usable.
export async function generateEmailExtraction(
  context: EmailExtractionContext,
  thread: string,
): Promise<EmailExtraction | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildEmailPrompt(context, thread) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseEmailExtraction(text);
}
