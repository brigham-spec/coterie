import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Quick-capture engine (gap-audit cluster E, ported from the prototype's
// showQuickCaptureModal, Coterie.html:16581). Turn a plain-English note about
// what just happened ("had coffee with Sarah from Bethel Woods, she needs a land
// use attorney, follow up Tuesday, intro her to Drew") into a structured, human-
// reviewable capture: which existing contacts were mentioned, a short meeting
// title + summary, follow-ups, suggested intros, and any brand-new prospects.
// Like the other AI features this is the single server-only seam: prompt, model,
// and output shape live here. The parse is EPHEMERAL — nothing is written until
// the operator reviews and saves.

// A tenant contact offered to the model as match context (id + who they are).
export type CaptureContact = { id: string; name: string; org: string };

// A suggested introduction the note implied — display-only (never auto-made).
export type CaptureIntro = { toOrg: string; reason: string };

// A brand-new prospect the note mentioned (not yet in the network).
export type CaptureProspect = { name: string; org: string; notes: string };

// The structured parse. matchedContactIds reference the supplied contacts; the
// caller re-verifies them inside withOrg before writing anything.
export type ParsedCapture = {
  matchedContactIds: string[];
  title: string;
  date: string;
  summary: string;
  actionItems: string[];
  suggestedIntros: CaptureIntro[];
  newProspects: CaptureProspect[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// PURE: coerce any JSON value to a trimmed, bounded string.
function str(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// PURE: normalize the action-items field. The model may return an array of lines
// or a single newline-delimited string ("bullets, one per line"); either way we
// end up with a clean list of non-empty lines (leading bullet glyphs stripped).
function toLines(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((v) => str(v, 300))
    : str(value, 2000).split("\n");
  return raw
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter((l) => l !== "");
}

// PURE: coerce the suggested-intros array, dropping entries with no target.
function toIntros(value: unknown): CaptureIntro[] {
  if (!Array.isArray(value)) return [];
  const out: CaptureIntro[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const r = v as Record<string, unknown>;
    const toOrg = str(r.toOrg, 160);
    if (toOrg === "") continue;
    out.push({ toOrg, reason: str(r.reason, 300) });
  }
  return out;
}

// PURE: coerce the new-prospects array, dropping entries with neither name nor org.
function toProspects(value: unknown): CaptureProspect[] {
  if (!Array.isArray(value)) return [];
  const out: CaptureProspect[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const r = v as Record<string, unknown>;
    const name = str(r.name, 120);
    const org = str(r.org, 160);
    if (name === "" && org === "") continue;
    out.push({ name, org, notes: str(r.notes, 400) });
  }
  return out;
}

/// PURE: parse the model's raw completion into a structured capture. Pulls the
/// JSON object out of any fence/prose, coerces each field, and defaults the date
/// to today when the model omitted or malformed it. Returns null when nothing
/// usable came back (no matched contacts, follow-ups, prospects, or summary) so
/// the caller can treat it as a failure.
export function parseQuickCapture(raw: string, today: string): ParsedCapture | null {
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

  const matchedContactIds = Array.isArray(obj.matchedContactIds)
    ? obj.matchedContactIds
        .map((v) => str(v, 60))
        .filter((v) => v !== "")
    : [];

  const dateRaw = str(obj.meetingDate, 40);
  const date = DATE_RE.test(dateRaw) ? dateRaw : today;

  const capture: ParsedCapture = {
    matchedContactIds,
    title: str(obj.meetingTitle, 160),
    date,
    summary: str(obj.summary, 1200),
    actionItems: toLines(obj.actionItems),
    suggestedIntros: toIntros(obj.suggestedIntros),
    newProspects: toProspects(obj.newProspects),
  };

  const empty =
    capture.matchedContactIds.length === 0 &&
    capture.actionItems.length === 0 &&
    capture.newProspects.length === 0 &&
    capture.summary === "";
  if (empty) return null;
  return capture;
}

/// PURE: the user prompt. Lists the tenant's contacts as match context (each
/// tagged with its id), tells the model today's date, and asks for the exact JSON
/// shape we consume. Grounds matches strictly in the supplied roster.
export function buildQuickCapturePrompt(
  note: string,
  contacts: CaptureContact[],
  today: string,
): string {
  const roster =
    contacts.length === 0
      ? "(no contacts on record)"
      : contacts
          .map((c) => `[ID:${c.id}] ${c.name}${c.org ? ` — ${c.org}` : ""}`)
          .join("\n");

  return `Parse this quick-capture note from a network manager into structured JSON. Return ONLY a valid JSON object — no markdown, no prose.

NETWORK CONTACTS (match people mentioned to these — use the exact ID):
${roster}

Today is ${today}.

Structure (use "" or [] for anything not present):
{"matchedContactIds":["ids of contacts clearly mentioned"],"meetingTitle":"short title","meetingDate":"${today}","summary":"1-2 sentence summary of what happened","actionItems":["one follow-up per item, include a date if the note gives one"],"suggestedIntros":[{"toOrg":"who to introduce them to","reason":"why"}],"newProspects":[{"name":"person","org":"company","notes":"context"}]}

Rules:
- Only include a contact id that appears in the list above; never invent an id.
- A person mentioned who is NOT in the list is a newProspect, not a matched contact.
- Ground everything strictly in the note — do not invent follow-ups, intros, or people.

NOTE:
${note.slice(0, 4000)}`;
}

const SYSTEM_PROMPT = `You convert a network manager's plain-English note into a structured capture for review. Return ONLY a single JSON object with the requested keys. Match people to the supplied contact roster by their exact ID; anyone not on the roster is a new prospect, never a matched id. Ground every field strictly in the note — never invent follow-ups, introductions, or contact details.`;

/// Parse a quick-capture note into structured fields. Ephemeral — nothing is
/// stored; the operator reviews and saves. Returns null when the model gives
/// nothing usable.
export async function generateQuickCapture(
  note: string,
  contacts: CaptureContact[],
  today: string,
): Promise<ParsedCapture | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 900,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildQuickCapturePrompt(note, contacts, today) },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseQuickCapture(text, today);
}
