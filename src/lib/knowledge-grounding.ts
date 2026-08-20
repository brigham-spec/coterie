import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { KNOWLEDGE_KIND_LABELS, isKnowledgeKind } from "@/lib/knowledge-docs";

// Grounding = the tenant's own collateral (KnowledgeDoc.content) folded into a
// capped text block the proposal / value-prop generators feed the model. This is
// the FIRST consumer of KnowledgeDoc.content. Kept lean: a withOrg loader + a pure
// builder so the builder stays unit-testable and any future generator (Step 3 SOP)
// can reuse the same grounding without re-querying differently.

export type GroundingDoc = {
  kind: string;
  title: string;
  content: string;
};

// Cap each doc and the whole block so a big collateral library can't blow the
// prompt budget. Sized to fit a full member deck (a real one runs ~14k chars):
// the Document Assistant answers factual questions and must see the WHOLE doc —
// a tier table late in the deck matters just as much as the positioning up top,
// so an 8k per-doc cap silently dropping ~40% of a deck would hide real answers.
export const MAX_DOC_CHARS = 20_000;
export const MAX_GROUNDING_CHARS = 40_000;
// Never pull more than this many docs into one prompt (newest first).
export const MAX_GROUNDING_DOCS = 12;

/**
 * Load the tenant's collateral for grounding, newest first. Runs inside a withOrg
 * transaction (RLS-scoped). Returns only the fields the builder needs — every
 * collateral kind is folded in so callers can ground on the whole document set.
 */
export async function loadKnowledgeGrounding(
  tx: Prisma.TransactionClient,
): Promise<GroundingDoc[]> {
  const docs = await tx.knowledgeDoc.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_GROUNDING_DOCS,
    select: { kind: true, title: true, content: true },
  });
  return docs;
}

// Label a doc by its kind, falling back to the raw kind for anything unknown.
function kindLabel(kind: string): string {
  return isKnowledgeKind(kind) ? KNOWLEDGE_KIND_LABELS[kind] : kind;
}

/**
 * Fold the loaded collateral into a single labelled text block for the prompt.
 * Each doc is capped to MAX_DOC_CHARS; the whole block to MAX_GROUNDING_CHARS.
 * Returns "" when there is nothing to ground on (the generators treat empty
 * grounding as "no collateral on file" and fall back to profile facts only).
 */
export function buildGroundingContext(docs: readonly GroundingDoc[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const doc of docs) {
    const body = doc.content.trim().slice(0, MAX_DOC_CHARS);
    if (body === "") continue;
    const block = `[${kindLabel(doc.kind)}] ${doc.title}\n${body}`;
    if (total + block.length > MAX_GROUNDING_CHARS) break;
    blocks.push(block);
    total += block.length;
  }
  return blocks.join("\n\n");
}
