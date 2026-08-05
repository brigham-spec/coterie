import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Org-level email-thread extraction engine (Email audit items 8 + 10, ported from
// the prototype's showEmailPasteModal, Coterie.html:16440). This is the
// network-wide sibling of extract-email.ts (which is anchored to ONE company
// profile and lands a flat EmailMessage). Here the operator pastes a thread on the
// Email Intelligence inbox and Claude reads it into a MEETING-shaped summary: who
// the sender is, a meeting title/date, the summary, action items, key insights,
// and any NEW organisations worth tracking as prospects. The caller matches the
// sender to an existing company deterministically (email-intel.matchEmailToCompany)
// — never a model-returned id — and, when nothing matches, creates a prospect from
// the sender. Server-only so the Anthropic key never reaches the browser; the
// result is EPHEMERAL until the operator reviews and saves.

// The sender the thread is about — used both to match an existing company and, on
// a miss, to seed a new prospect (org → company name, name → primary contact).
export type ThreadContact = {
  name: string;
  org: string;
  email: string;
  title: string;
};

// A NEW organisation the thread surfaced (not the sender) — offered as an extra
// prospect to create alongside the meeting.
export type ThreadProspect = {
  name: string;
  org: string;
  email: string;
  notes: string;
};

// The extracted thread. Strings use "" for "nothing found"; actionItems is
// semicolon-separated (mirrors the EmailMessage convention) and gets folded into
// the saved Meeting.summary since a Meeting has no free-text action-item field.
export type EmailThreadExtraction = {
  primaryContact: ThreadContact;
  meetingTitle: string;
  meetingDate: string;
  summary: string;
  actionItems: string;
  keyInsights: string;
  newProspects: ThreadProspect[];
};

// The org and its member companies, so the model can tell an existing member from
// a genuinely new organisation when populating newProspects.
export type EmailThreadContext = {
  orgName: string;
  memberOrgs: string[];
};

// PURE: coerce any JSON value to a trimmed, bounded string. Defends against the
// literal "null" the model sometimes emits for an empty field.
function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

// PURE: coerce one JSON value into a ThreadProspect, or null if it carries no
// identifying org/name (so blank rows the model pads with are dropped).
function prospect(value: unknown): ThreadProspect | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const p: ThreadProspect = {
    name: str(obj.name, 120),
    org: str(obj.org, 200),
    email: str(obj.email, 200),
    notes: str(obj.notes, 500),
  };
  if (p.name === "" && p.org === "") return null;
  return p;
}

/// PURE: parse the model's raw completion into a structured thread. Returns null
/// when nothing usable came back (no summary AND no sender AND no title) so the
/// caller can treat it as "couldn't read this thread".
export function parseEmailThreadExtraction(
  raw: string,
): EmailThreadExtraction | null {
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

  const contact =
    typeof obj.primaryContact === "object" && obj.primaryContact !== null
      ? (obj.primaryContact as Record<string, unknown>)
      : {};

  const rawProspects = Array.isArray(obj.newProspects) ? obj.newProspects : [];
  const newProspects = rawProspects
    .map(prospect)
    .filter((p): p is ThreadProspect => p !== null)
    .slice(0, 10);

  const extraction: EmailThreadExtraction = {
    primaryContact: {
      name: str(contact.name, 120),
      org: str(contact.org, 200),
      email: str(contact.email, 200),
      title: str(contact.title, 120),
    },
    meetingTitle: str(obj.meetingTitle, 200),
    meetingDate: str(obj.meetingDate, 40),
    summary: str(obj.summary, 2000),
    actionItems: str(obj.actionItems, 1000),
    keyInsights: str(obj.keyInsights, 1000),
    newProspects,
  };

  if (
    extraction.summary === "" &&
    extraction.meetingTitle === "" &&
    extraction.primaryContact.name === "" &&
    extraction.primaryContact.org === ""
  )
    return null;
  return extraction;
}

/// PURE: the user prompt. Gives the org and its members as context so the model
/// only puts genuinely NEW organisations in newProspects, then asks for the exact
/// JSON we consume. The thread body is bounded to keep the request small.
export function buildThreadPrompt(
  context: EmailThreadContext,
  thread: string,
): string {
  const members = context.memberOrgs.filter(Boolean).slice(0, 60).join(", ");
  return `Read this email thread for ${context.orgName} and extract structured CRM intelligence as a meeting note.

Existing organisations in the network (do NOT list these as new prospects): ${members || "(none on file)"}

Identify the external sender (the person NOT at ${context.orgName}). Focus on the MOST RECENT message for current status. Quote real names, dates, and follow-ups. Prefer "" over inventing anything.

Return ONLY a valid JSON object (no markdown, no prose):
{"primaryContact":{"name":"the external sender's full name","org":"their organisation","email":"their email address","title":"their role/title, or \\"\\""},"meetingTitle":"a short title for this correspondence, strip RE:/FW:","meetingDate":"date of the most recent message, YYYY-MM-DD. \\"\\" if not stated","summary":"2-3 sentence summary of where things stand","actionItems":"semicolon-separated follow-ups or next steps. \\"\\" if none","keyInsights":"notable facts worth remembering. \\"\\" if none","newProspects":[{"name":"a person's name","org":"a NEW organisation mentioned that is not already in the network","email":"their email or \\"\\"","notes":"why they matter"}]}

Leave newProspects an empty array if no genuinely new organisations came up.

EMAIL THREAD:
${thread.slice(0, 8000)}`;
}

const SYSTEM_PROMPT = `You analyse a pasted email thread for a CRM and turn it into a meeting note. Return ONLY a single JSON object with the requested keys. Extract only information explicitly present in the thread — never invent, infer, or hallucinate. An empty string is always better than invented content.`;

/// Extract structured intelligence from a pasted email thread. Ephemeral —
/// nothing is stored; the operator reviews and saves. Returns null when the model
/// gives nothing usable.
export async function generateEmailThreadExtraction(
  context: EmailThreadContext,
  thread: string,
): Promise<EmailThreadExtraction | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildThreadPrompt(context, thread) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseEmailThreadExtraction(text);
}
