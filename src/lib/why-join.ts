import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Why-join pitch engine (gap-audit cluster E, ported from the prototype's
// membership-pitch generator, Coterie.html:1489). Given a prospect and the
// network they'd be joining, write a compelling, specific membership case: why
// the network is valuable to THEM — the members they'd meet, the network's track
// record in their sector, the open project roles their expertise fits, and a
// ready-to-edit outreach email. Like the other AI features this is the single
// server-only seam: prompt, model, and output shape live here so tenant data only
// leaves through a shape we control and the API key never reaches the browser.
// Grounded strictly in the supplied context — no invented members, projects, or
// achievements — and EPHEMERAL (nothing is stored).

// The prospect the pitch is written for.
export type PitchProspect = {
  name: string;
  org: string | null;
  industry: string | null;
  seeking: string | null;
  brings: string | null;
  notes: string | null;
};

// One current member the prospect could be introduced to on day one.
export type PitchMember = {
  name: string;
  org: string | null;
  industry: string | null;
  seeking: string | null;
  brings: string | null;
};

export type WhyJoinInput = {
  orgName: string;
  host: string;
  prospect: PitchProspect;
  memberCount: number;
  // A one-line read on how represented the prospect's sector already is.
  industryPresence: string;
  // Open project roles the prospect's expertise could fill (terse descriptors).
  openRoles: string[];
  members: PitchMember[];
};

// One suggested day-one introduction.
export type PitchIntro = { name: string; org: string | null; reason: string };

export type WhyJoinPitch = {
  headline: string;
  networkValue: string;
  trackRecord: string;
  openRoles: string;
  industryPosition: string;
  topIntros: PitchIntro[];
  emailSubject: string;
  emailBody: string;
};

// PURE: coerce one intro entry, dropping anything without a member name.
function coerceIntro(item: unknown): PitchIntro | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name === "") return null;
  const org = typeof o.org === "string" && o.org.trim() !== "" ? o.org.trim() : null;
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  return { name, org, reason };
}

// PURE: read a string field, defaulting to "" when absent or the wrong type.
function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v.trim() : "";
}

/// PURE: parse + validate the model's JSON object into a pitch. Returns null when
/// the response isn't a usable object (no headline AND no email body means there's
/// nothing worth showing). Robust to prose/markdown-fenced responses. topIntros is
/// capped so a runaway list can't blow up the panel.
export function parseWhyJoinPitch(raw: string): WhyJoinPitch | null {
  const json = extractJsonObject(raw);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const o = parsed as Record<string, unknown>;

  const topIntros = Array.isArray(o.topIntros)
    ? o.topIntros
        .map(coerceIntro)
        .filter((i): i is PitchIntro => i !== null)
        .slice(0, 4)
    : [];

  const pitch: WhyJoinPitch = {
    headline: str(o, "headline"),
    networkValue: str(o, "networkValue"),
    trackRecord: str(o, "trackRecord"),
    openRoles: str(o, "openRoles"),
    industryPosition: str(o, "industryPosition"),
    topIntros,
    emailSubject: str(o, "emailSubject"),
    emailBody: str(o, "emailBody"),
  };

  // Nothing usable came back — signal failure rather than an empty shell.
  if (pitch.headline === "" && pitch.emailBody === "") return null;
  return pitch;
}

const SYSTEM_PROMPT = `You are a network-development advisor writing a compelling membership case for a private economic-development network. Use ONLY the prospect and network data provided. Be specific and accurate — cite members and projects by name from the data. Do NOT invent achievements, relationships, members, or facts not present in the context.`;

/// PURE: the user prompt. All context is embedded as JSON so the model can cite
/// members and roles by name; the required output shape is spelled out exactly.
export function buildWhyJoinPrompt(input: WhyJoinInput): string {
  const { orgName, host, prospect, memberCount, industryPresence, openRoles, members } =
    input;

  return `Write a personalized membership pitch for ${orgName} to send to this prospect.

PROSPECT:
${JSON.stringify(prospect, null, 2)}

NETWORK CONTEXT:
- ${memberCount} active members across the region.
- Sector representation for this prospect: ${industryPresence}
- Open project roles matching their expertise:
${openRoles.length ? openRoles.map((r) => `  - ${r}`).join("\n") : "  (none identified)"}

CURRENT MEMBERS (for identifying specific day-one introductions):
${JSON.stringify(members, null, 2)}

Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "headline": "<one sharp sentence — the single most compelling reason they should join>",
  "networkValue": "<2-3 sentences on specific members and introductions they would get>",
  "trackRecord": "<2-3 sentences on the network's experience in their sector; only cite what is present>",
  "openRoles": "<1-2 sentences on immediate project opportunities where their expertise is needed>",
  "industryPosition": "<1-2 sentences on their unique position in the network>",
  "topIntros": [{"name": "<member name from the data>", "org": "<org>", "reason": "<why this intro matters>"}],
  "emailSubject": "<subject line>",
  "emailBody": "<3-4 paragraph personalized outreach email — warm, specific, no fluff. Sign as ${host}, ${orgName}>"
}
Every member named in topIntros MUST be one of the CURRENT MEMBERS above.`;
}

/// Generate the membership pitch. Ephemeral — nothing is stored; the caller
/// re-runs on demand. Returns null if the model gives nothing usable.
export async function generateWhyJoinPitch(
  input: WhyJoinInput,
): Promise<WhyJoinPitch | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildWhyJoinPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseWhyJoinPitch(text);
}
