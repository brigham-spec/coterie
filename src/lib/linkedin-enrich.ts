import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { withAiRetry } from "@/lib/ai-retry";
import { extractJsonArray } from "@/lib/json-extract";

// LinkedIn bulk enrichment seam (recall-layer step 2). Given the STATED fields a
// connection carried in from the export (name, company, title), the model infers
// a few searchable dimensions — industry, seniority, job function — that were
// never stated. This is the single server-only Anthropic seam: prompt, model, and
// output shape live here so tenant data only leaves through a shape we control and
// the API key never reaches the browser.
//
// Integrity is the cardinal rule of the recall layer: an inference must never be
// dressed up as fact. Every dimension the model fills is stamped `inferred` (never
// `stated`) and graded high/low confidence, and the prompt is told to return null
// — not a guess — whenever the three stated fields give no real basis. Geography
// is DELIBERATELY not inferred here (it's deferred to the promotion pass); the
// prompt forbids it.

// The confidence grade WITHIN an inferred dimension. "high" only when the stated
// fields make the classification unambiguous; "low" for a plausible-but-thin call.
export type LinkedinConfidence = "high" | "low";

// The provenance stamp written to every *Source column this pass fills. Bulk
// enrichment only ever produces inferences — stated fields already carry their own
// verbatim values from the CSV.
export const LINKEDIN_INFERRED_SOURCE = "inferred";

// One person handed to the model, tagged with an opaque `ref` so the returned
// array can be matched back to the row regardless of order or omissions.
export type LinkedinEnrichInput = {
  ref: string;
  fullName: string;
  company: string;
  title: string;
};

// The inferred dimensions for one person. A null value means "no basis to infer";
// its confidence is null too (you cannot be confident about nothing).
export type LinkedinEnrichment = {
  ref: string;
  industry: string | null;
  industryConfidence: LinkedinConfidence | null;
  seniority: string | null;
  seniorityConfidence: LinkedinConfidence | null;
  jobFunction: string | null;
  jobFunctionConfidence: LinkedinConfidence | null;
};

// PURE: coerce a raw JSON value into a trimmed, bounded category string, or null.
// Treats "" and the literal "null" as absent, so a model that emits an empty
// placeholder is read as "couldn't determine" rather than a bogus category.
function category(value: unknown, max = 60): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "" || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
}

// PURE: resolve one dimension's value + confidence together, enforcing the
// integrity rule that uncertainty is never rounded up. A null value forces a null
// confidence; a present value is "high" ONLY when the model explicitly said so,
// otherwise it degrades to "low" (a missing/garbled grade is treated as weak).
function dimension(
  valueRaw: unknown,
  confidenceRaw: unknown,
): { value: string | null; confidence: LinkedinConfidence | null } {
  const value = category(valueRaw);
  if (value === null) return { value: null, confidence: null };
  const confidence: LinkedinConfidence = confidenceRaw === "high" ? "high" : "low";
  return { value, confidence };
}

/// PURE: parse + validate the model's JSON array into per-person enrichments.
/// Each entry is matched back to a supplied row by `ref`; entries whose ref isn't
/// in `validRefs` (or repeats one already seen) are dropped so a hallucinated or
/// duplicated ref can never write onto the wrong person. Robust to non-JSON /
/// non-array responses (returns []). Writes nothing — the caller persists.
export function parseLinkedinEnrichments(
  raw: string,
  validRefs: ReadonlySet<string>,
): LinkedinEnrichment[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: LinkedinEnrichment[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const ref = String(o.ref ?? "");
    if (!validRefs.has(ref) || seen.has(ref)) continue;
    seen.add(ref);

    const ind = dimension(o.industry, o.industryConfidence);
    const sen = dimension(o.seniority, o.seniorityConfidence);
    const fun = dimension(o.jobFunction, o.jobFunctionConfidence);
    out.push({
      ref,
      industry: ind.value,
      industryConfidence: ind.confidence,
      seniority: sen.value,
      seniorityConfidence: sen.confidence,
      jobFunction: fun.value,
      jobFunctionConfidence: fun.confidence,
    });
  }
  return out;
}

const SYSTEM_PROMPT = `You classify professional connections for a searchable recall layer. For each person you are given ONLY their name, company, and job title — nothing else. From those three stated fields, infer three dimensions:

- "industry": the company's primary sector, 1-4 words (e.g. "Commercial Real Estate", "Healthcare", "Software").
- "seniority": one of exactly: "C-Suite", "VP", "Director", "Manager", "Senior", "Individual Contributor".
- "jobFunction": the functional area, one of: "Engineering", "Sales", "Marketing", "Finance", "Operations", "Legal", "Human Resources", "Product", "Design", "Consulting", "Executive", "Other".

Integrity rules — these override everything:
- Infer ONLY what the name/company/title genuinely support. If a field gives you no real basis, return null for that dimension — never guess.
- Do NOT research or invent facts beyond the three stated fields.
- Do NOT infer geography or location.
- For each non-null dimension, grade your confidence: "high" only when the stated fields make it unambiguous, otherwise "low".

Return ONLY a JSON array (no prose, no markdown fences). Echo back each person's "ref" exactly. Each element:
{"ref":"<the ref>","industry":"<sector or null>","industryConfidence":"high|low or null","seniority":"<level or null>","seniorityConfidence":"high|low or null","jobFunction":"<function or null>","jobFunctionConfidence":"high|low or null"}
Use null (not the string "null") when there is no basis. Return an element for every person.`;

/// Infer the searchable dimensions for a batch of connections. Returns one
/// enrichment per person the model could classify (matched by ref); an empty input
/// short-circuits to []. Retries only transient 429s (withAiRetry). Persists
/// nothing — the caller stamps the rows.
export async function generateLinkedinEnrichments(
  inputs: readonly LinkedinEnrichInput[],
): Promise<LinkedinEnrichment[]> {
  if (inputs.length === 0) return [];
  const validRefs = new Set(inputs.map((i) => i.ref));

  const client = new Anthropic();
  const response = await withAiRetry(() =>
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `PEOPLE:\n${JSON.stringify(
            inputs.map((i) => ({
              ref: i.ref,
              name: i.fullName,
              company: i.company,
              title: i.title,
            })),
          )}`,
        },
      ],
    }),
  );

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseLinkedinEnrichments(text, validRefs);
}
