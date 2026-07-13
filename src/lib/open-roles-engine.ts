import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";
import type { IntroCompanyProfile } from "@/lib/intro-engine";
import type { Discipline } from "@/lib/disciplines";

// Open-roles engine (slice 11.4c, ported from the prototype's doOpenRolesScan).
// Given a specific project and one unfilled discipline plus a pool of companies
// that plausibly do that work, rank the strongest candidates to staff the role and
// name an honest concern for each. This is the introduction engine's third mode but
// a distinct concern from intro suggestions — it staffs a named gap on a named
// project — so it lives in its own file. Like the other AI features this is the
// single server-only seam: prompt, model, and output shape live here so tenant data
// only leaves through a shape we control and the API key never reaches the browser.

// The slice of a project the model reasons over when staffing a role — factual and
// terse so it matches capability to need rather than embellishing.
export type RoleScanProject = {
  name: string;
  stage: string;
  type: string | null;
  county: string | null;
  units: number | null;
  value: string | null;
  description: string | null;
};

// A ranked candidate for the open role. score 5/4/3 reads as Strong / Good /
// Possible fit; concern is the one honest gap (may be empty).
export type RoleCandidate = {
  companyId: string;
  companyName: string;
  score: number;
  whyFit: string;
  concern: string;
};

function coerceRoleCandidate(
  item: unknown,
  validIds: ReadonlySet<string>,
): RoleCandidate | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const companyId = typeof o.companyId === "string" ? o.companyId : "";
  // Reject anything the model invented that isn't a real candidate id.
  if (!validIds.has(companyId)) return null;

  const scoreRaw = typeof o.score === "number" ? o.score : Number(o.score);
  if (!Number.isFinite(scoreRaw)) return null;
  // Vocabulary is 5/4/3 = Strong / Good / Possible; floor to 3 so a model that
  // returns a lower number lands on the weakest real rung, never an unlabeled 2.
  const score = Math.max(3, Math.min(5, Math.round(scoreRaw)));

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  return {
    companyId,
    companyName: str(o.companyName),
    score,
    whyFit: str(o.whyFit),
    concern: str(o.concern),
  };
}

/// PURE: parse + validate the model's JSON array into ranked candidates, dropping
/// any entry whose companyId isn't a supplied candidate (no hallucinated targets),
/// and sort by score (desc). Robust to non-JSON / non-array responses.
export function parseRoleCandidates(
  raw: string,
  validIds: ReadonlySet<string>,
): RoleCandidate[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: RoleCandidate[] = [];
  for (const item of parsed) {
    const c = coerceRoleCandidate(item, validIds);
    if (c) out.push(c);
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

const SYSTEM_PROMPT = `You are a precise network matchmaker for an economic-development organization, helping staff one specific open role on one specific active project. From the CANDIDATES supplied, rank those genuinely suited to the role.

Score each candidate you include, 5 down to 3:
5 — Strong: has clearly done this exact kind of work at a comparable type/scale/geography, with concrete evidence in the supplied data.
4 — Good: a solid capability match for the role, supported by the data.
3 — Possible: plausible but the evidence is thin or the fit is partial.
Only include candidates scoring 3 or higher; return fewer, stronger candidates rather than padding.

Ground every claim in the supplied data — do not invent capabilities, projects, people, or history that is not present. Be honest: name a real concern or gap for each candidate (leave it empty only if there genuinely is none).

Return ONLY a JSON array (no prose, no markdown code fences). Each element:
{"companyId": "<one of the candidate ids>", "companyName": "<name>", "score": <5|4|3>, "whyFit": "<2-3 sentences citing specific evidence>", "concern": "<one honest gap, or empty string>"}
companyId MUST be one of the supplied candidate ids. If no candidate scores 3 or higher, return [].`;

/// Rank companies to fill one open discipline on one project. Validates the model's
/// output against the supplied candidate ids (no hallucinated targets). Ephemeral —
/// nothing is stored; the caller re-runs on demand.
export async function generateRoleCandidates(
  project: RoleScanProject,
  role: Discipline,
  candidates: IntroCompanyProfile[],
): Promise<RoleCandidate[]> {
  if (candidates.length === 0) return [];

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `OPEN ROLE: ${role.label}\n\nPROJECT:\n${JSON.stringify(project, null, 2)}\n\nCANDIDATES:\n${JSON.stringify(candidates, null, 2)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const validIds = new Set(candidates.map((c) => c.id));
  return parseRoleCandidates(text, validIds);
}
