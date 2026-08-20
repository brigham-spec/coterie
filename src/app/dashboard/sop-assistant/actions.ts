"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  buildGroundingContext,
  loadKnowledgeGrounding,
} from "@/lib/knowledge-grounding";
import { generateSopAnswer, type SopAnswer } from "@/lib/sop-assistant";

// Document assistant action (knowledge layer). askSop loads ALL of the tenant's
// own uploaded collateral (every KnowledgeDoc kind — decks, value props, SOPs,
// one-pagers, other) in ONE withOrg tx (RLS scopes it), grounds the answer
// strictly in that material, and returns it. Ephemeral — nothing is stored; the
// question is answered on demand and rendered inline via useActionState.
//
// An org with no documents on file short-circuits to a friendly message WITHOUT a
// paid model call. Citations are validated inside the generator against the real
// document titles so a hallucinated source can never surface.

export type SopAssistantState =
  | { status: "idle" }
  | { status: "ok"; question: string; answer: SopAnswer }
  | { status: "empty" }
  | { status: "error"; message: string };

export async function askSop(
  _prev: SopAssistantState,
  formData: FormData,
): Promise<SopAssistantState> {
  const { orgId, orgName } = await requireOrgContext();

  const question = String(formData.get("question") ?? "").trim();
  if (question === "")
    return { status: "error", message: "Ask a question first." };

  const docs = await withOrg(orgId, (tx) => loadKnowledgeGrounding(tx));
  const grounding = buildGroundingContext(docs);
  if (grounding === "") return { status: "empty" };

  const validCitations = new Set(docs.map((d) => d.title));

  try {
    await enforceAiRateLimit(orgId);
    const answer = await generateSopAnswer(
      { orgName, question, grounding },
      validCitations,
    );
    return { status: "ok", question, answer };
  } catch (err) {
    console.error("sop assistant failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not answer that question. Try again." };
  }
}
