// Collateral knowledge store — pure vocabulary + text hygiene shared by the
// upload action, the extractor, and any future AI grounding. No server-only /
// DB / AI here so it stays unit-testable.
//
// A KnowledgeDoc is a piece of a tenant's own collateral (a pitch deck, a value
// prop one-pager, an SOP) stored as EXTRACTED TEXT — never a binary. It grounds
// the proposal + prospect value-prop generators in each org's real material,
// per-tenant (an org only ever sees its own docs).

export const KNOWLEDGE_KINDS = [
  "deck",
  "value_prop",
  "sop",
  "other",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  deck: "Pitch deck",
  value_prop: "Value proposition",
  sop: "SOP / playbook",
  other: "Other",
};

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_KINDS as readonly string[]).includes(value)
  );
}

export const MAX_TITLE_LENGTH = 120;
// Cap the stored text so one huge upload can't bloat a row or a later prompt.
export const MAX_TEXT_LENGTH = 200_000;
// Reject oversized uploads before we even try to extract.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Trim, collapse internal whitespace, cap to MAX_TITLE_LENGTH. */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

/**
 * Normalize extracted document text: normalize line endings, strip trailing
 * spaces, collapse 3+ blank lines to one, trim the ends, and cap length. Keeps
 * paragraph breaks (single blank lines) so structure survives for grounding.
 */
export function normalizeExtractedText(raw: string): string {
  const normalized = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.slice(0, MAX_TEXT_LENGTH);
}
