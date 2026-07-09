import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Pre-meeting brief (gap-audit cluster A, ported from the prototype's "AI Prep"
// at Coterie.html:17267). Given a company the user is about to meet — its record,
// the recent meetings its people attended, and the still-open commitments on
// either side — the model writes a terse two-sentence prep note: what matters
// most in that relationship right now, and what was last committed. Like the
// other AI features this is the single server-only seam: prompt, model, and
// output shape live here so tenant data only leaves through a shape we control
// and the API key never reaches the browser.
//
// EPHEMERAL — nothing is stored. It is regenerated on demand before a meeting.

// A commitment still outstanding on this relationship. `owedBy` is which side
// owns the follow-up: "us" = a staff member owes the company; "them" = one of
// the company's contacts owes us. Both sharpen the "what was committed" sentence.
export type PrepCommitment = { text: string; owedBy: "us" | "them" };

// The relationship the user is about to walk into. Everything here is assembled
// by the caller inside a withOrg tx, so it is already org-scoped. Free-text and
// optional fields are nullable; the prompt builder omits whatever is absent.
export type MeetingPrepInput = {
  userName: string;
  company: {
    name: string;
    status: string;
    industry: string | null;
    tier: string | null;
    lookingFor: string | null;
    canOffer: string | null;
    notes: string | null;
    contacts: Array<{ name: string; title: string | null }>;
    projects: Array<{ name: string; stage: string; role: string }>;
  };
  recentMeetings: Array<{ title: string; heldAt: string; summary: string | null }>;
  openCommitments: PrepCommitment[];
};

/// PURE: assemble the compact grounding block the model reads. Omits empty /
/// absent fields entirely (an omitted field is better than a blank one the model
/// might pad around). Kept separate from the network call so the shaping is
/// unit-testable without an API key.
export function buildPrepContext(input: MeetingPrepInput): string {
  const { company } = input;
  const lines: string[] = [];

  lines.push(`COMPANY: ${company.name}`);
  lines.push(`STATUS: ${company.status}`);
  if (company.tier) lines.push(`TIER: ${company.tier}`);
  if (company.industry) lines.push(`INDUSTRY: ${company.industry}`);
  if (company.lookingFor) lines.push(`LOOKING FOR: ${company.lookingFor}`);
  if (company.canOffer) lines.push(`CAN OFFER: ${company.canOffer}`);
  if (company.notes) lines.push(`NOTES: ${company.notes}`);

  if (company.contacts.length > 0) {
    const people = company.contacts
      .map((c) => (c.title ? `${c.name} (${c.title})` : c.name))
      .join(", ");
    lines.push(`CONTACTS: ${people}`);
  }

  if (company.projects.length > 0) {
    const projects = company.projects
      .map((p) => `${p.name} — ${p.stage} (${p.role})`)
      .join("; ");
    lines.push(`PROJECTS: ${projects}`);
  }

  if (input.recentMeetings.length > 0) {
    lines.push("");
    lines.push("RECENT MEETINGS (most recent first):");
    for (const m of input.recentMeetings) {
      const summary = m.summary ? ` — ${m.summary}` : "";
      lines.push(`- ${m.heldAt}: ${m.title}${summary}`);
    }
  }

  if (input.openCommitments.length > 0) {
    lines.push("");
    lines.push("OPEN COMMITMENTS:");
    for (const c of input.openCommitments) {
      const side = c.owedBy === "us" ? "we owe them" : "they owe us";
      lines.push(`- (${side}) ${c.text}`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You write a terse pre-meeting prep note for a relationship manager at an economic-development organization, moments before they meet a company in their network.

Write EXACTLY two sentences, no more, no less:
- Sentence 1: the most important thing in this relationship right now — the state of play, the live project, or the reason this meeting matters.
- Sentence 2: what was last committed, by either side, and therefore what to follow up on. If there are no open commitments, say what the natural next step is.

Ground every claim in the supplied data — cite specific details (names, projects, commitments) and never invent facts, figures, or history that is not present. If a detail is absent, work with what is there rather than speculating. Write in plain, direct prose addressed to the reader; no headers, no bullet points, no preamble like "Here is your prep".`;

/// Generate the two-sentence prep note. Ephemeral — nothing is stored; the caller
/// renders it inline before the meeting. Throws on an empty model response so the
/// action can surface a friendly error.
export async function generateMeetingPrep(
  input: MeetingPrepInput,
): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Prepping ${input.userName} to meet ${input.company.name}.\n\n${buildPrepContext(input)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") throw new Error("empty response from the model");

  return text;
}
