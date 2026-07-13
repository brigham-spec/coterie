import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// Introduction engine (slices 11.4b/c, ported from the prototype's doIntroForMember
// and doProactiveAlertScan). Two modes over the same terse company profiles:
//   • PER-MEMBER (11.4b): given a FOCUS company + a candidate pool, score which
//     candidates the focus should be introduced to and why.
//   • PROACTIVE (11.4c): given the whole network, surface the highest-value NEW
//     pairings to make right now (symmetric — two companies, no single focus).
// Like the company brief (@/lib/anthropic), this is the single server-only seam to
// Anthropic for the feature: the prompts, model choice, and output shapes live
// here, so tenant data never leaves except through a shape we control and the API
// key never reaches the browser. Results are EPHEMERAL — regenerated on demand;
// only user dismissals are persisted (intro_dismissals), fed in as exclusions.

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

// A proactive pairing (slice 11.4c) is symmetric — it names TWO companies the
// network should connect right now, rather than scoring candidates for one focus.
export type ProactivePairing = {
  companyAId: string;
  companyAName: string;
  companyBId: string;
  companyBName: string;
  score: number;
  connectionType: string;
  headline: string;
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
  // The prompt asks for candidates scoring 3 or higher, so clamp the weakest
  // real rung to 3 — never surface a 1-2 the vocabulary doesn't define.
  const score = Math.max(3, Math.min(5, Math.round(scoreRaw)));

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

// ── Proactive network scan (slice 11.4c) ─────────────────────────────────────

/// PURE: a canonical, ORIENTATION-INDEPENDENT key for a company pair. An intro
/// A→B is the same relationship as B→A, so both the already-introduced set and
/// the dismissal ledger are keyed this way to exclude a pair no matter which side
/// the model puts first.
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function coercePairing(
  item: unknown,
  validIds: ReadonlySet<string>,
  excludedPairs: ReadonlySet<string>,
): ProactivePairing | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const aId = typeof o.companyAId === "string" ? o.companyAId : "";
  const bId = typeof o.companyBId === "string" ? o.companyBId : "";
  // Both sides must be real network companies, distinct, and not an existing or
  // dismissed pairing.
  if (!validIds.has(aId) || !validIds.has(bId)) return null;
  if (aId === bId) return null;
  if (excludedPairs.has(pairKey(aId, bId))) return null;

  const scoreRaw = typeof o.score === "number" ? o.score : Number(o.score);
  if (!Number.isFinite(scoreRaw)) return null;
  // The prompt asks for candidates scoring 3 or higher, so clamp the weakest
  // real rung to 3 — never surface a 1-2 the vocabulary doesn't define.
  const score = Math.max(3, Math.min(5, Math.round(scoreRaw)));

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const talkingPoints = Array.isArray(o.talkingPoints)
    ? o.talkingPoints
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim())
        .slice(0, 3)
    : [];

  return {
    companyAId: aId,
    companyAName: str(o.companyAName),
    companyBId: bId,
    companyBName: str(o.companyBName),
    score,
    connectionType: str(o.connectionType),
    headline: str(o.headline),
    whyNow: str(o.whyNow),
    talkingPoints,
  };
}

/// PURE: parse + validate the model's JSON array into pairings — dropping entries
/// with a hallucinated/duplicate/self id or an already-made/dismissed pair, and
/// de-duplicating on the canonical pair key (keeping the higher score). Sorted by
/// score (desc). Robust to non-JSON / non-array responses.
export function parseProactivePairings(
  raw: string,
  validIds: ReadonlySet<string>,
  excludedPairs: ReadonlySet<string>,
): ProactivePairing[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byPair = new Map<string, ProactivePairing>();
  for (const item of parsed) {
    const p = coercePairing(item, validIds, excludedPairs);
    if (!p) continue;
    const k = pairKey(p.companyAId, p.companyBId);
    const existing = byPair.get(k);
    if (!existing || p.score > existing.score) byPair.set(k, p);
  }
  return [...byPair.values()].sort((a, b) => b.score - a.score);
}

const MAX_PROACTIVE_POOL = 30;

const PROACTIVE_SYSTEM_PROMPT = `You are an introduction strategist for an economic-development organization that connects the companies in its network. Given the whole NETWORK (a pool of companies), identify the highest-value NEW introductions to make right now — each between a pair of DIFFERENT companies in the pool.

Score each pairing you include, 5 down to 3:
5 — the introduction removes a named barrier or fills a specific open project role for one side.
4 — a specific needed capability on one side, matched by the other, with concrete evidence in the supplied data.
3 — a complementary fit: each has something the other is looking for.
Only include pairings scoring 3 or higher. Return fewer, stronger pairings rather than padding; do not repeat a pair.

Ground every claim in the supplied data — do not invent needs, projects, people, capabilities, or history that is not present. Reference each company by what the data actually says (lookingFor, canOffer, networkTags, projects).

Return ONLY a JSON array (no prose, no markdown code fences). Each element:
{"companyAId": "<one of the company ids>", "companyAName": "<name>", "companyBId": "<a different company id>", "companyBName": "<name>", "score": <5|4|3>, "connectionType": "<short label, e.g. 'Capital ↔ Project'>", "headline": "<one line>", "whyNow": "<the current trigger>", "talkingPoints": ["<up to 3 short concrete openers>"]}
Both ids MUST be from the supplied companies and different. If no pairing scores 3 or higher, return [].`;

/// Proactive network-wide scan: bound the pool to the highest-signal companies,
/// ask the model for the best new pairings, and validate against the pool + the
/// caller's excluded-pair set (already introduced + dismissed). Ephemeral.
export async function generateProactivePairings(
  companies: IntroCompanyProfile[],
  excludedPairs: ReadonlySet<string>,
): Promise<ProactivePairing[]> {
  const pool = prioritizeCandidates(companies, MAX_PROACTIVE_POOL);
  if (pool.length < 2) return [];

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    system: PROACTIVE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `NETWORK:\n${JSON.stringify(pool, null, 2)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const validIds = new Set(pool.map((c) => c.id));
  return parseProactivePairings(text, validIds, excludedPairs);
}
