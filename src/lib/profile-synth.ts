import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Profile synthesis engine (gap-audit cluster E, ported from the prototype's
// synthesizeProfile + showBatchSynthModal, Coterie.html:9029 / 11668). Reads
// EVERYTHING the network knows about one company — meetings, event-conversation
// notes, introductions made, open + completed commitments, saved articles, and
// its active projects — then proposes updates to the structured relationship
// fields the intro engine and filters depend on. Like the other AI seams this is
// server-only: the prompt, model, and output shape live here. The result is
// EPHEMERAL and only the fields the operator explicitly selects are written (via
// applyCompanySynthesis in the companies list's synth-actions).
//
// Accuracy is paramount: every field the model returns must be traceable to the
// evidence above, and "" (no change) is always preferable to invented content.
// A free-text "projects" field is intentionally NOT an output — production keeps
// projects in a relational table, so any project intel is folded into the notes
// append (with a citation) instead of a standalone column.

// The company being synthesized, plus its current field values so the model can
// tell what is already known and only surface genuinely new intelligence.
export type SynthCompanyContext = {
  name: string;
  contactName: string;
  industry: string;
  status: string;
  lookingFor: string;
  canOffer: string;
  counties: string[];
  agencyContacts: string;
  dealSize: string;
  notes: string;
};

// The grounding evidence, each section already flattened to display strings by
// the calling action. Empty sections are omitted from the prompt.
export type SynthEvidence = {
  meetings: { date: string; title: string; summary: string }[];
  eventNotes: string[];
  intros: string[];
  openItems: string[];
  doneItems: string[];
  articles: string[];
  projects: string[];
};

// The proposed update. Every writable field is a string; "" means "no change".
// `counties` is a comma-joined list of NEW counties only (existing ones dropped).
// `summary` is a one-line read of what the evidence revealed (display-only).
export type ProfileSynthesis = {
  summary: string;
  lookingFor: string;
  canOffer: string;
  counties: string;
  agencyContacts: string;
  dealSize: string;
  notesAppend: string;
};

// PURE: coerce any JSON value to a trimmed, bounded string. The model is told to
// use "" for empty, but this also defends against the literal string "null".
function str(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.toLowerCase() === "null" ? "" : t.slice(0, max);
}

// PURE: clear a suggestion that merely echoes the current value (case-insensitive)
// so the review only shows genuinely new intelligence.
function clearEcho(next: string, current: string): string {
  return next !== "" && next.toLowerCase() !== current.trim().toLowerCase()
    ? next
    : "";
}

/// PURE: parse the model's raw completion into a structured synthesis. Pulls the
/// JSON object out of any fence/prose, coerces each field, drops suggestions that
/// echo the current value, and — for counties — keeps only counties not already
/// on record. Returns null when nothing usable came back (every writable field
/// empty).
export function parseProfileSynthesis(
  raw: string,
  current: SynthCompanyContext,
): ProfileSynthesis | null {
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

  // Counties: split the model's comma list, drop empties and any county already
  // on record (case-insensitive), so we only ever propose additions.
  const existing = new Set(current.counties.map((c) => c.trim().toLowerCase()));
  const counties = str(obj.counties, 200)
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "" && !existing.has(c.toLowerCase()))
    .join(", ");

  const synthesis: ProfileSynthesis = {
    summary: str(obj.summary, 300),
    lookingFor: clearEcho(str(obj.lookingFor, 240), current.lookingFor),
    canOffer: clearEcho(str(obj.canOffer, 240), current.canOffer),
    counties,
    agencyContacts: clearEcho(str(obj.agencyContacts, 240), current.agencyContacts),
    dealSize: clearEcho(str(obj.dealSize, 120), current.dealSize),
    notesAppend: str(obj.notesAppend, 500),
  };

  const empty =
    synthesis.lookingFor === "" &&
    synthesis.canOffer === "" &&
    synthesis.counties === "" &&
    synthesis.agencyContacts === "" &&
    synthesis.dealSize === "" &&
    synthesis.notesAppend === "";
  if (empty) return null;
  return synthesis;
}

// PURE: render one evidence section as a labeled block, or "" when it is empty.
function section(label: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `${label}:\n${lines.join("\n")}\n\n`;
}

/// PURE: the user prompt. Gives the company's current field values as context,
/// then every non-empty evidence section, then the strict cite-or-null contract
/// and the exact JSON shape we consume.
export function buildSynthPrompt(
  context: SynthCompanyContext,
  evidence: SynthEvidence,
): string {
  const meetingBlock = evidence.meetings.map((m) => {
    const parts = [`[${m.date}] ${m.title || "Meeting"}`];
    if (m.summary) parts.push(`  ${m.summary.replace(/\n/g, " ").slice(0, 400)}`);
    return parts.join("\n");
  });

  const currentFields = [
    context.lookingFor && `Looking For: ${context.lookingFor}`,
    context.canOffer && `Can Offer: ${context.canOffer}`,
    context.counties.length > 0 && `Counties: ${context.counties.join(", ")}`,
    context.agencyContacts && `Agency Contacts: ${context.agencyContacts}`,
    context.dealSize && `Deal Size: ${context.dealSize}`,
    context.notes && `Profile Notes: ${context.notes.slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a CRM intelligence analyst. Read all available records for one company, then suggest specific updates to its structured relationship fields.

COMPANY: ${context.name}${context.contactName ? ` (contact: ${context.contactName})` : ""} — ${context.industry || "industry not set"} — ${context.status}

CURRENT STRUCTURED FIELDS:
${currentFields || "(no structured data yet)"}

${section("MEETING HISTORY", meetingBlock)}${section("EVENT CONVERSATION NOTES", evidence.eventNotes)}${section("INTRODUCTIONS MADE", evidence.intros)}${section("OPEN COMMITMENTS", evidence.openItems)}${section("COMPLETED COMMITMENTS", evidence.doneItems)}${section("SAVED ARTICLES / RESEARCH", evidence.articles)}${section("ACTIVE PROJECTS (already tracked — do not re-list)", evidence.projects)}TASK: Based ONLY on the information above for THIS company, identify what should change. Look for:
- What they explicitly said they are seeking or need (lookingFor) — only if stated directly.
- Expertise or resources they explicitly said they can offer others (canOffer) — only if stated.
- Counties or regions they are active in (counties) — comma-separated.
- Government/agency relationships they have or need (agencyContacts).
- Their typical deal size or investment range (dealSize).
- Any important new strategic context (notesAppend) — including project intel worth recording.

STRICT RULES — ACCURACY IS PARAMOUNT:
- Use ONLY facts explicitly and directly stated above. Never infer, guess, or invent project names, dollar amounts, locations, or relationships.
- If the evidence is sparse, vague, or absent for a field, return "" for it. Never fill gaps with plausible content.
- For notesAppend: only NEW context (1-2 sentences), prefixed with a citation like "per [YYYY-MM-DD] meeting:" or "per saved article: <title>:". Never repeat existing notes.
- When in doubt, return "". An empty string is ALWAYS better than invented information.

Return ONLY a valid JSON object (no markdown, no prose):
{"summary":"1-2 sentence read of what the evidence reveals","lookingFor":"","canOffer":"","counties":"","agencyContacts":"","dealSize":"","notesAppend":""}`;
}

const SYSTEM_PROMPT = `You are a CRM data analyst. You ONLY extract and organize information explicitly provided to you. You NEVER invent, infer, or hallucinate facts. If information is not clearly stated in the input, you return "" for that field. Accuracy is paramount — an empty value is always preferable to invented content.`;

/// Synthesize a company's profile from its internal records. Ephemeral — nothing
/// is stored; the operator reviews and applies selected fields. Returns null when
/// the model gives nothing usable.
export async function generateProfileSynthesis(
  context: SynthCompanyContext,
  evidence: SynthEvidence,
): Promise<ProfileSynthesis | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildSynthPrompt(context, evidence) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseProfileSynthesis(text, context);
}
