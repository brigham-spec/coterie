import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonObject } from "@/lib/json-extract";

// SOP assistant (knowledge layer, Step 3). Any staff member asks an operational
// question ("how do we onboard a new member?", "what's our refund policy?") and
// gets an answer grounded STRICTLY in the org's own SOP / playbook collateral
// (KnowledgeDoc rows of kind "sop"). Like the proposal generator this is the
// single server-only seam: prompt, model, and output shape live here so tenant
// data only leaves through a shape we control and the API key never reaches the
// browser.
//
// PER-TENANT: the grounding is the org's own uploaded SOPs — nothing is hardcoded
// to any one client. An org with no SOPs on file gets a plain "no SOPs uploaded"
// message from the caller (no model call at all).
//
// INTEGRITY: the model answers ONLY from the supplied SOP material and cites the
// SOP doc(s) it drew from. When the SOPs don't cover the question it says so
// (answered=false) rather than inventing an answer. citations are validated
// against the real SOP titles so a hallucinated source collapses away.
//
// EPHEMERAL — nothing is stored. Each question is answered on demand.

// Everything the assistant reads. `grounding` is the pre-built SOP block from
// buildGroundingContext (only ever non-empty when the org has SOPs on file).
export type SopAssistantInput = {
  orgName: string;
  question: string;
  grounding: string;
};

// The model's structured output. `answered` is false when the SOPs don't address
// the question; `citations` are SOP doc titles (validated) the answer drew from.
export type SopAnswer = {
  answer: string;
  answered: boolean;
  citations: string[];
};

/// PURE: assemble the compact block the model reads — the org name plus the SOP
/// material it must answer from. Kept separate from the network call so the
/// shaping is unit-testable without an API key.
export function buildSopContext(input: SopAssistantInput): string {
  const lines: string[] = [];
  lines.push(`ORGANIZATION: ${input.orgName}`);
  lines.push("");
  lines.push("STANDARD OPERATING PROCEDURES (answer only from this material):");
  lines.push(input.grounding);
  return lines.join("\n");
}

/// PURE: parse + validate the model's JSON object into an answer. Drops any cited
/// title that isn't one of the supplied SOP docs (no invented sources) and clears
/// citations entirely when the model reports the SOPs didn't cover the question.
/// Robust to non-JSON / malformed responses — a bad payload yields an empty answer
/// rather than throwing.
export function parseSopAnswer(
  raw: string,
  validCitations: ReadonlySet<string>,
): SopAnswer {
  const empty: SopAnswer = { answer: "", answered: false, citations: [] };

  const json = extractJsonObject(raw);
  if (json === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;

  const o = parsed as Record<string, unknown>;
  const answer = typeof o.answer === "string" ? o.answer.trim() : "";
  const answered = o.answered === true;

  const rawCites = Array.isArray(o.citations) ? o.citations : [];
  const citations = answered
    ? [
        ...new Set(
          rawCites.filter(
            (c): c is string =>
              typeof c === "string" && validCitations.has(c),
          ),
        ),
      ]
    : [];

  return { answer, answered, citations };
}

const SYSTEM_PROMPT = `You are an internal operations assistant for a member-based organization (an economic-development corporation, chamber, wealth-advisory network, or similar). A staff member asks an operational question and you answer it using ONLY the organization's own standard operating procedures (SOPs) supplied to you.

Return ONLY a JSON object (no prose outside it, no markdown code fences):
{"answer": "<the answer>", "answered": <true|false>, "citations": ["<exact SOP title>", ...]}

- "answer": a clear, direct answer to the question, drawn strictly from the supplied SOPs. Quote or paraphrase the real procedure. Use plain paragraphs or short steps.
- "answered": true if the SOPs actually address the question, false if they do not.
- "citations": the exact TITLE(S) of the SOP document(s) your answer drew from, copied verbatim from the "[SOP / playbook] Title" labels. Empty array if answered is false.

Rules:
- Answer ONLY from the supplied SOPs. Never use outside knowledge, never invent a procedure, figure, name, or policy that is not in the material.
- If the SOPs do not cover the question, set "answered" to false and let "answer" say plainly that the organization's SOPs on file do not cover this, so the staff member should check with a manager — do not guess.
- Cite by exact document title only; never cite a title that was not supplied.`;

/// Generate the grounded SOP answer. Ephemeral — nothing is stored. Validates the
/// cited titles against the supplied SOP docs so a hallucinated source can never
/// surface. Throws on an empty model response so the caller can fall back gracefully.
export async function generateSopAnswer(
  input: SopAssistantInput,
  validCitations: ReadonlySet<string>,
): Promise<SopAnswer> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${buildSopContext(input)}\n\nQUESTION: ${input.question}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (text === "") throw new Error("empty response from the model");

  const answer = parseSopAnswer(text, validCitations);
  if (answer.answer === "") throw new Error("empty answer from the model");

  return answer;
}
