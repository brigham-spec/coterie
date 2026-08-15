import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// Pre-meeting brief (gap-audit cluster A, ported from the prototype's "AI Prep"
// at Coterie.html:17267, then broadened). Given a company the user is about to
// meet — its record, the recent meetings its people attended, the still-open
// commitments on either side, recent coverage, the value delivered so far, and a
// pool of network companies it could be introduced to — the model writes a robust
// pre-meeting brief: a narrative that picks up where the last meeting left off and
// says what to raise, plus grounded introduction recommendations. Like the other
// AI features this is the single server-only seam: prompt, model, and output shape
// live here so tenant data only leaves through a shape we control and the API key
// never reaches the browser.
//
// INTEGRITY: the model writes only the connective narrative + intro rationales.
// The concrete facts — open action items, news headlines, value figures — are
// rendered VERBATIM from the DB by the caller, never paraphrased by the model, and
// every recommended companyId is validated against the supplied candidate pool
// (hallucinated ids are dropped) so the brief can never invent a company to meet.
//
// EPHEMERAL — nothing is stored. It is regenerated on demand before a meeting.

// A commitment still outstanding on this relationship. `owedBy` is which side
// owns the follow-up: "us" = a staff member owes the company; "them" = one of
// the company's contacts owes us. Both sharpen the "what was committed" thread.
export type PrepCommitment = { text: string; owedBy: "us" | "them" };

// A network company the focus could be introduced to, reduced to the signals the
// model matches on. The caller assembles the pool (focus + already-introduced
// companies excluded) inside a withOrg tx, so it is already org-scoped.
export type PrepCandidate = {
  id: string;
  name: string;
  industry: string | null;
  lookingFor: string | null;
  canOffer: string | null;
};

// A concise snapshot of value delivered to this company so far — the same totals
// the profile's Value Delivered card shows, folded into the brief so the user can
// remind the company what membership has returned. Non-monetary wins count toward
// entryCount but contribute nothing to totalAmount.
export type PrepValueSnapshot = {
  totalAmount: number;
  entryCount: number;
  monetaryCount: number;
};

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
  recentNews: Array<{ headline: string; capturedAt: string }>;
  valueSnapshot: PrepValueSnapshot;
  candidates: PrepCandidate[];
};

// A grounded introduction the brief recommends. companyId is validated against the
// supplied candidate pool before it reaches the caller, so it always resolves to a
// real network company the user can open.
export type PrepIntroRec = {
  companyId: string;
  companyName: string;
  reason: string;
};

// The model's structured output: a narrative pre-meeting brief plus the grounded
// introductions to raise. The verbatim fact sections (action items, news, value)
// are rendered by the caller from the DB, not from this — the model only writes
// the connective tissue and the intro rationales.
export type MeetingPrepBrief = {
  narrative: string;
  introRecommendations: PrepIntroRec[];
};

// Cap the candidate pool the model reads so a large network still yields a bounded
// prompt. The caller passes candidates in a stable (name) order and bounds its own
// query to roughly this many, so the slice here is just a hard ceiling.
export const MAX_CANDIDATES = 30;

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

  if (input.recentNews.length > 0) {
    lines.push("");
    lines.push("RECENT NEWS (most recent first):");
    for (const n of input.recentNews) {
      lines.push(`- ${n.capturedAt}: ${n.headline}`);
    }
  }

  const v = input.valueSnapshot;
  if (v.entryCount > 0) {
    lines.push("");
    const dollars =
      v.totalAmount > 0
        ? `$${v.totalAmount.toLocaleString("en-US")} across ${v.monetaryCount} of them`
        : "no dollar figure attached yet";
    lines.push(
      `VALUE DELIVERED SO FAR: ${v.entryCount} win${v.entryCount === 1 ? "" : "s"} (${dollars}).`,
    );
  }

  if (input.candidates.length > 0) {
    lines.push("");
    lines.push("CANDIDATE COMPANIES FOR INTRODUCTIONS (pick only grounded fits):");
    for (const c of input.candidates.slice(0, MAX_CANDIDATES)) {
      const bits = [c.industry, c.lookingFor && `looking for ${c.lookingFor}`, c.canOffer && `offers ${c.canOffer}`]
        .filter(Boolean)
        .join("; ");
      lines.push(`- [${c.id}] ${c.name}${bits ? ` — ${bits}` : ""}`);
    }
  }

  return lines.join("\n");
}

/// PURE: parse + validate the model's JSON object into a brief. Drops any intro
/// recommendation whose companyId isn't a supplied candidate (no hallucinated
/// targets) and caps the list. Robust to non-JSON / malformed responses — a bad
/// payload yields an empty narrative + no recommendations rather than throwing.
export function parseMeetingPrep(
  raw: string,
  validIds: ReadonlySet<string>,
): MeetingPrepBrief {
  const json = extractJsonObject(raw);
  if (json === null) return { narrative: "", introRecommendations: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { narrative: "", introRecommendations: [] };
  }
  if (typeof parsed !== "object" || parsed === null)
    return { narrative: "", introRecommendations: [] };

  const o = parsed as Record<string, unknown>;
  const narrative = typeof o.narrative === "string" ? o.narrative.trim() : "";

  const recs: PrepIntroRec[] = [];
  if (Array.isArray(o.introRecommendations)) {
    for (const item of o.introRecommendations) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as Record<string, unknown>;
      const companyId = typeof r.companyId === "string" ? r.companyId : "";
      if (!validIds.has(companyId)) continue; // reject invented targets
      const companyName = typeof r.companyName === "string" ? r.companyName.trim() : "";
      const reason = typeof r.reason === "string" ? r.reason.trim() : "";
      recs.push({ companyId, companyName, reason });
      if (recs.length >= 3) break; // keep the brief tight
    }
  }

  return { narrative, introRecommendations: recs };
}

const SYSTEM_PROMPT = `You write a pre-meeting brief for a relationship manager at an economic-development organization, moments before they meet a company in their network. The reader wants to walk in knowing exactly where things stand and what to raise.

Return ONLY a JSON object (no prose outside it, no markdown code fences):
{"narrative": "<the brief>", "introRecommendations": [{"companyId": "<one of the candidate ids>", "companyName": "<name>", "reason": "<one grounded sentence on why this intro is worth making now>"}]}

The "narrative" is 2-4 short sentences of flowing prose (no headers, no bullets, no preamble like "Here is your brief"):
- Open by picking up where the LAST meeting left off — the live thread, the state of play.
- Weave in what still needs following up (the open commitments) and any recent news worth mentioning.
- Close on the single most useful thing to accomplish in this meeting.
Do NOT restate the raw lists of action items or news verbatim — the reader already sees those; your job is to synthesize and prioritize.

"introRecommendations": from the CANDIDATE COMPANIES pool only, name up to 3 introductions that are genuinely worth making, each grounded in what the data says (a matched need/offer, a shared project, a complementary fit). companyId MUST be one of the supplied candidate ids. If none is a strong, grounded fit, return an empty array — never pad with generic matches.

Ground every claim in the supplied data — cite specific details (projects, commitments, needs) and never invent facts, figures, history, or companies that are not present. If a detail is absent, work with what is there rather than speculating.`;

/// Generate the structured pre-meeting brief. Ephemeral — nothing is stored; the
/// caller renders it inline (its own verbatim fact sections alongside). Validates
/// every recommended companyId against the candidate pool so a hallucinated target
/// can never surface. Throws on an empty model response so the action can surface a
/// friendly error.
export async function generateMeetingPrep(
  input: MeetingPrepInput,
): Promise<MeetingPrepBrief> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
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

  const validIds = new Set(input.candidates.slice(0, MAX_CANDIDATES).map((c) => c.id));
  const brief = parseMeetingPrep(text, validIds);
  if (brief.narrative === "") throw new Error("empty brief from the model");

  return brief;
}
