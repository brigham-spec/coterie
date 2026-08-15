// LinkedIn recall search (recall-layer step 3). The tenant asks "who do I know
// that does X" in plain English and gets back the connections whose stated +
// inferred fields best match — a searchable prosthetic over a 1,000+ export.
//
// This is DELIBERATELY deterministic, diverging from the AI-based member search
// in network-search.ts (they are NOT unified). Two reasons: (1) cost — an AI pass
// over the whole connection graph on every keystroke-scale search is wasteful and
// slow; (2) integrity — the cardinal rule of the recall layer is that an
// inference never passes as fact. A deterministic scorer can report EXACTLY which
// field matched (and whether it was stated or inferred, at what confidence), so
// the UI can show a match's provenance. An opaque model ranking cannot.
//
// PURE: no server-only, no DB, no AI. The action owns fetching only enriched rows
// (enrichedAt != null) — un-enriched connections are invisible to recall by
// construction, so this module never sees them.

// The subset of an enriched connection this search reads + returns. Stated fields
// (fullName/company/title) are verbatim from the export; the three inferred
// dimensions carry their high/low confidence so a hit can be shown honestly.
export type LinkedinSearchRow = {
  id: string;
  fullName: string;
  company: string;
  title: string;
  profileUrl: string | null;
  industry: string | null;
  industryConfidence: string | null;
  seniority: string | null;
  seniorityConfidence: string | null;
  jobFunction: string | null;
  jobFunctionConfidence: string | null;
};

export type LinkedinSearchField =
  | "fullName"
  | "company"
  | "title"
  | "industry"
  | "seniority"
  | "jobFunction";

// A ranked result: the row, its score, and EXACTLY which fields the query hit —
// so the UI can highlight the reason and mark inferred matches as inferred.
export type LinkedinSearchHit = {
  row: LinkedinSearchRow;
  score: number;
  matched: LinkedinSearchField[];
};

// Display metadata per searchable field, shared by every surface that renders a
// match or a dimension (the connections table + the recall-search results). A
// field is INFERRED iff it names its confidence column — those are the enrichment
// guesses that must never be shown as stated fact. Stated fields have none.
export const FIELD_META: Record<
  LinkedinSearchField,
  { label: string; confidenceKey: keyof LinkedinSearchRow | null }
> = {
  fullName: { label: "name", confidenceKey: null },
  company: { label: "company", confidenceKey: null },
  title: { label: "title", confidenceKey: null },
  industry: { label: "industry", confidenceKey: "industryConfidence" },
  seniority: { label: "seniority", confidenceKey: "seniorityConfidence" },
  jobFunction: { label: "function", confidenceKey: "jobFunctionConfidence" },
};

// The single rule for how an inferred dimension is badged: its label always
// carries the "inferred" marker + a high/low grade (defaulting to the cautious
// "low" when absent), and a high-confidence guess reads differently (teal) from a
// low one (slate). Everything that shows an inference reuses this so an inference
// can never be styled or worded as a stated fact in one place but not another.
export function inferredBadge(confidence: string | null): {
  tone: "teal" | "slate";
  label: string;
} {
  const grade = confidence ?? "low";
  return { tone: grade === "high" ? "teal" : "slate", label: `inferred · ${grade}` };
}

// Question-scaffolding words a natural-language recall query ("who do I know that
// works in finance") carries but that must not drive matching. Content words like
// "finance"/"sales"/"engineering" are DELIBERATELY absent — dropping those would
// silently gut the search.
const STOPWORDS = new Set([
  "who", "whom", "whose", "do", "does", "did", "i", "you", "we", "know",
  "knows", "known", "that", "which", "a", "an", "the", "in", "of", "at", "on",
  "for", "to", "my", "me", "with", "and", "or", "is", "are", "any", "anyone",
  "someone", "somebody", "people", "person", "connection", "connections",
]);

// Weighted searchable fields, in the fixed order used for BOTH scoring and
// provenance display. The three inferred dimensions outweigh the stated free-text
// fields: they're the deliberate "does X" signal the enrichment pass produced,
// whereas a token landing in a company or person name is weaker evidence.
const FIELDS: {
  field: LinkedinSearchField;
  weight: number;
  value: (r: LinkedinSearchRow) => string | null;
}[] = [
  { field: "industry", weight: 3, value: (r) => r.industry },
  { field: "jobFunction", weight: 3, value: (r) => r.jobFunction },
  { field: "title", weight: 2, value: (r) => r.title },
  { field: "seniority", weight: 2, value: (r) => r.seniority },
  { field: "company", weight: 2, value: (r) => r.company },
  { field: "fullName", weight: 1, value: (r) => r.fullName },
];

const DEFAULT_LIMIT = 50;

/// PURE: split a natural-language query into lowercased, de-duplicated content
/// tokens — dropping question scaffolding and 1-char noise. Order and repetition
/// don't matter; each distinct token is matched independently.
export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

// PURE: does one query token match a field value? Substring match with light
// plural tolerance so "engineers" finds "Engineering" and "directors" finds
// "Director". Nothing fuzzier than that — a match must stay explainable.
function tokenMatches(token: string, value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes(token)) return true;
  if (token.length > 3 && token.endsWith("s") && v.includes(token.slice(0, -1)))
    return true;
  return false;
}

/// PURE: deterministic recall search over already-enriched connections. Scores
/// each row by which stated + inferred fields the query tokens hit, drops
/// non-matches, and returns the top `limit` ranked by score, then by breadth of
/// match (distinct tokens hit), then name. Every hit reports which fields matched.
export function searchLinkedinContacts(
  rows: readonly LinkedinSearchRow[],
  query: string,
  limit = DEFAULT_LIMIT,
): LinkedinSearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const scored: (LinkedinSearchHit & { breadth: number })[] = [];
  for (const row of rows) {
    let score = 0;
    const matched: LinkedinSearchField[] = [];
    const matchedTokens = new Set<string>();

    for (const { field, weight, value } of FIELDS) {
      const v = value(row);
      if (!v) continue;
      let fieldMatched = false;
      for (const token of tokens) {
        if (tokenMatches(token, v)) {
          fieldMatched = true;
          matchedTokens.add(token);
        }
      }
      if (fieldMatched) {
        score += weight;
        matched.push(field);
      }
    }

    if (score > 0)
      scored.push({ row, score, matched, breadth: matchedTokens.size });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.breadth - a.breadth ||
      a.row.fullName.localeCompare(b.row.fullName),
  );

  return scored
    .slice(0, limit)
    .map(({ row, score, matched }) => ({ row, score, matched }));
}
