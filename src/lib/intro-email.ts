import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Draft-introduction-email engine (gap-audit cluster E, ported from the
// prototype's "Draft Introduction Email" modal, Coterie.html:11382). Given two
// parties in the network and an optional reason, write the warm double-opt-in
// email the host would send connecting them — the last-mile draft the host edits
// and sends. Like the other AI features this is the single server-only seam:
// prompt, model, and output shape live here so tenant data only leaves through a
// shape we control and the API key never reaches the browser. The draft is
// grounded strictly in the two supplied profiles — no invented projects,
// meetings, or relationships — and is EPHEMERAL (nothing is stored).

// One side of the introduction. Descriptors we hold on the party's CRM profile —
// the engine cites these to make the email specific rather than generic.
export type IntroParty = {
  name: string;
  org: string | null;
  title: string | null;
  industry: string | null;
  seeking: string | null;
  brings: string | null;
};

export type IntroEmailInput = {
  orgName: string;
  host: string;
  partyA: IntroParty;
  partyB: IntroParty;
  // Free-text reason for the connection (optional) — e.g. "as a construction
  // partner for the Mill Redevelopment". Steers the model when present.
  context: string;
};

// The split draft: a subject line (may be empty if the model omitted one) and the
// email body. Rendered as an editable draft, never sent by the app.
export type IntroEmailDraft = { subject: string; body: string };

/// PURE: split the model's raw completion into { subject, body }. Strips a
/// wrapping markdown fence, then peels a leading "SUBJECT: ..." line into the
/// subject and treats the remainder as the body. When no subject line is present
/// the subject is "" and the whole text is the body. Returns null when nothing
/// usable is left (empty / whitespace-only, or only a subject with no body) so the
/// caller can treat it as a failure.
export function parseIntroEmail(raw: string): IntroEmailDraft | null {
  let text = raw.trim();
  if (text === "") return null;

  // Remove a wrapping ``` / ```email code fence if the whole draft is fenced.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();

  let subject = "";
  // A leading "Subject: <line>", optionally followed by the body on later lines.
  const m = text.match(/^\s*subject:\s*([^\r\n]*)(?:\r?\n([\s\S]*))?$/i);
  if (m) {
    subject = m[1].trim();
    text = (m[2] ?? "").trim();
  }

  if (text === "") return null;
  return { subject, body: text };
}

// PURE: one context line, only when the value is present (keeps the prompt tight
// and stops the model treating an empty field as a fact to fill in).
function line(label: string, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "" : `  ${label}: ${v.slice(0, 220)}`;
}

// PURE: the profile block for one party — only the descriptors on record.
function partyBlock(p: IntroParty): string {
  return [
    line("Name", p.name),
    line("Organization", p.org),
    line("Title", p.title),
    line("Industry", p.industry),
    line("Seeking", p.seeking),
    line("Brings / can offer", p.brings),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/// PURE: the full user prompt handed to the model. Grounds the email in the two
/// party profiles and asks for a subject line then the body; when a reason is
/// supplied it is threaded through as the specific context for the connection.
export function buildIntroEmailPrompt(input: IntroEmailInput): string {
  const { host, orgName, partyA, partyB, context } = input;
  const reason = context.trim();

  return `You are drafting a warm introduction email on behalf of ${host} at ${orgName}, connecting two members of the network to each other.

RULES — follow exactly:
- First line: "SUBJECT: <a specific, compelling subject line>".
- Then a blank line, then the email body.
- Use first names throughout.
- Open by referencing something specific about each person's work — use the profile data below.
- Explain exactly WHY this introduction is valuable: cite what each is seeking and what each brings to the other.
- 3-4 short paragraphs maximum. Be concise and direct, never generic.
- Close with a clear suggested next step (a call, a site visit).
- Sign off as ${host}, ${orgName}.
- Ground every specific claim strictly in the two profiles below — do NOT invent projects, meetings, or relationships.
- No corporate filler ("I hope this finds you well", "I'm reaching out").
${reason ? `\nSPECIFIC CONTEXT for this introduction: ${reason}\n` : ""}
== PARTY A — who is being introduced ==
${partyBlock(partyA) || "  (no profile on record)"}

== PARTY B — who they are being introduced to ==
${partyBlock(partyB) || "  (no profile on record)"}`;
}

const SYSTEM_PROMPT = `You draft warm, professional double-opt-in introduction emails for the host of a private economic-development network. Write in the host's first-person voice, peer-to-peer, warm but direct. Ground every specific claim strictly in the two supplied profiles — never invent meetings, projects, or relationships. Output a "SUBJECT:" line, a blank line, then the email body — nothing else.`;

/// Draft the introduction email connecting the two parties. Ephemeral — nothing
/// is stored; the caller re-runs on demand. Returns null when the model gives
/// nothing usable.
export async function generateIntroEmail(
  input: IntroEmailInput,
): Promise<IntroEmailDraft | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildIntroEmailPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseIntroEmail(text);
}
