import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Per-member introduction engine (slice 11.4b, ported from the prototype's
// doIntroForMember). Given a FOCUS company in the network and a pool of candidate
// companies, the model scores which candidates the focus should be introduced to
// and why. Like the company brief (@/lib/anthropic), this is the single server-
// only seam to Anthropic for this feature: the prompt, model choice, and output
// shape live here, so tenant data never leaves except through a shape we control
// and the API key never reaches the browser. Suggestions are EPHEMERAL — nothing
// is persisted; they are regenerated on demand.

// A company reduced to the signals the model reasons over. Kept terse and factual
// so the model matches rather than embellishes.
export type IntroCompanyProfile = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  tier: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  networkTags: string[];
  counties: string[];
  primaryContact: { name: string; title: string | null } | null;
  projects: Array<{ name: string; stage: string; role: string }>;
};

export type IntroSuggestion = {
  companyId: string;
  companyName: string;
  score: number;
  connectionType: string;
  headline: string;
  whatItAdvances: string;
  whyNow: string;
  talkingPoints: string[];
};

/// PURE: eligible candidate ids — every company except the focus itself and any
/// company already introduced to it (dedup handled by the caller's Set).
export function eligibleCandidateIds(
  focusId: string,
  candidateIds: readonly string[],
  alreadyIntroducedIds: ReadonlySet<string>,
): string[] {
  return candidateIds.filter(
    (id) => id !== focusId && !alreadyIntroducedIds.has(id),
  );
}

/// PURE: a coarse "how much does the model have to work with" score for a
/// candidate profile. Used only to prioritize which candidates to send when the
/// pool is large (keeping the prompt bounded) — NOT the match score, which the
/// model assigns. Rewards expressed needs/offers, tags, and active projects.
export function candidateSignalScore(p: IntroCompanyProfile): number {
  let s = 0;
  if (p.lookingFor && p.lookingFor.trim() !== "") s += 2;
  if (p.canOffer && p.canOffer.trim() !== "") s += 2;
  s += Math.min(p.networkTags.length, 3);
  s += Math.min(p.projects.length, 3);
  if (p.primaryContact) s += 1;
  return s;
}

/// PURE: rank a candidate pool by signal (desc, stable by name) and cap it, so a
/// large network still yields a bounded prompt.
export function prioritizeCandidates(
  candidates: readonly IntroCompanyProfile[],
  limit: number,
): IntroCompanyProfile[] {
  return [...candidates]
    .sort(
      (a, b) =>
        candidateSignalScore(b) - candidateSignalScore(a) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/// PURE: extract the first top-level JSON array from a model response, tolerating
/// stray prose or markdown fences around it. Returns null if none is present.
function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function coerceSuggestion(
  item: unknown,
  validIds: ReadonlySet<string>,
): IntroSuggestion | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const companyId = typeof o.companyId === "string" ? o.companyId : "";
  // Reject anything the model invented that isn't a real candidate id.
  if (!validIds.has(companyId)) return null;

  const scoreRaw = typeof o.score === "number" ? o.score : Number(o.score);
  if (!Number.isFinite(scoreRaw)) return null;
  const score = Math.max(2, Math.min(5, Math.round(scoreRaw)));

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const talkingPoints = Array.isArray(o.talkingPoints)
    ? o.talkingPoints
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim())
        .slice(0, 3)
    : [];

  return {
    companyId,
    companyName: str(o.companyName),
    score,
    connectionType: str(o.connectionType),
    headline: str(o.headline),
    whatItAdvances: str(o.whatItAdvances),
    whyNow: str(o.whyNow),
    talkingPoints,
  };
}

/// PURE: parse + validate the model's JSON array into suggestions, dropping any
/// entry whose companyId isn't a supplied candidate (no hallucinated targets),
/// and sort by score (desc). Robust to non-JSON / non-array responses.
export function parseSuggestions(
  raw: string,
  validIds: ReadonlySet<string>,
): IntroSuggestion[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: IntroSuggestion[] = [];
  for (const item of parsed) {
    const s = coerceSuggestion(item, validIds);
    if (s) out.push(s);
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

const MAX_CANDIDATES = 40;

const SYSTEM_PROMPT = `You are an introduction strategist for an economic-development organization that connects the companies in its network. Given a FOCUS company and a pool of CANDIDATE companies, decide which candidates the focus should be introduced to, and why.

Score each candidate you include, 5 down to 3:
5 — the introduction removes a named barrier or fills a specific open project role.
4 — a specific needed capability, with concrete evidence in the supplied data.
3 — a complementary fit: each has something the other is looking for.
Only include candidates scoring 3 or higher. Omit weak or generic matches entirely; returning fewer, stronger suggestions is better than padding.

Ground every claim in the supplied data — do not invent needs, projects, people, capabilities, or history that is not present. Reference the focus and candidate by what the data actually says (lookingFor, canOffer, networkTags, projects).

Return ONLY a JSON array (no prose, no markdown code fences). Each element:
{"companyId": "<one of the candidate ids>", "companyName": "<candidate name>", "score": <5|4|3>, "connectionType": "<short label, e.g. 'Capital ↔ Project'>", "headline": "<one line>", "whatItAdvances": "<what this unlocks for the focus>", "whyNow": "<the current trigger>", "talkingPoints": ["<up to 3 short concrete openers>"]}
companyId MUST be one of the supplied candidate ids. If no candidate scores 3 or higher, return [].`;

export async function generateIntroSuggestions(
  focus: IntroCompanyProfile,
  candidates: IntroCompanyProfile[],
): Promise<IntroSuggestion[]> {
  const pool = prioritizeCandidates(candidates, MAX_CANDIDATES);
  if (pool.length === 0) return [];

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `FOCUS:\n${JSON.stringify(focus, null, 2)}\n\nCANDIDATES:\n${JSON.stringify(pool, null, 2)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const validIds = new Set(pool.map((c) => c.id));
  return parseSuggestions(text, validIds);
}
