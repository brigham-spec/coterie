import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { extractJsonArray } from "@/lib/json-extract";

// News Intelligence engine (slice 11.9, ported from the prototype's
// fetchMemberNews). Given ONE company (and its active projects), Claude's
// web_search tool finds recent press coverage, project announcements, permits,
// capital raises, and groundbreakings from the last 12 months, then returns them
// as structured articles. Like the other AI features this is the single
// server-only seam: prompt, model, tool config, and output shape live here so the
// Anthropic key never reaches the browser. Results are EPHEMERAL until the user
// explicitly saves an article to the NewsItem ledger.

// One discovered article. `date` is a free-text publication date the model
// reports (may be blank); `url` is null when the model can't cite a source.
export type NewsArticle = {
  headline: string;
  source: string;
  date: string;
  url: string | null;
  summary: string;
  significance: string;
};

// The company context a scan reasons over. Terse and factual so the model
// grounds its search in this specific organisation rather than a generic one.
export type NewsScanInput = {
  orgName: string;
  companyName: string;
  contactName: string;
  industry: string;
  counties: string[];
  website: string | null;
  projects: Array<{ name: string; stage: string; county: string }>;
};

// Defensive cap on how many articles we accept back (the prompt asks for 5).
const MAX_ARTICLES = 8;

// The web_search tool wraps cited claims in <cite index="…">…</cite> markup; if
// left in place it renders as literal tag text on the news card and, once saved,
// in the Project Press & News view. Strip the tags but keep their inner text.
function stripCitations(v: string): string {
  return v.replace(/<\/?cite\b[^>]*>/gi, "");
}

function coerceArticle(item: unknown): NewsArticle | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;

  const str = (v: unknown) =>
    typeof v === "string" ? stripCitations(v).trim() : "";

  const headline = str(o.headline) || str(o.title);
  // An article with no headline is unusable; drop it.
  if (headline === "") return null;

  const urlRaw = str(o.url);
  const url = /^https?:\/\//i.test(urlRaw) ? urlRaw : null;

  return {
    headline,
    source: str(o.source),
    date: str(o.date),
    url,
    summary: str(o.summary),
    significance: str(o.significance),
  };
}

/// PURE: parse + validate the model's JSON array into articles, dropping entries
/// with no headline and de-duplicating by URL within the batch (a web search can
/// echo the same story from mirrored feeds). Robust to non-JSON / non-array
/// responses (web-search replies can be chatty), capped to MAX_ARTICLES.
export function parseNewsArticles(raw: string): NewsArticle[] {
  const json = extractJsonArray(raw);
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seenUrls = new Set<string>();
  const out: NewsArticle[] = [];
  for (const item of parsed) {
    const a = coerceArticle(item);
    if (a === null) continue;
    if (a.url !== null) {
      const key = a.url.toLowerCase();
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
    }
    out.push(a);
    if (out.length >= MAX_ARTICLES) break;
  }
  return out;
}

// PURE: the full user prompt handed to the model (with the web_search tool).
// Grounds the search in this company + its projects and the tenant's region.
function buildPrompt(input: NewsScanInput): string {
  const region = input.counties.length
    ? input.counties.join(", ") + " (Hudson Valley, NY)"
    : "Hudson Valley, New York";
  const projectLines = input.projects.length
    ? "\nKnown projects: " +
      input.projects
        .map((p) => `${p.name} (${p.stage}${p.county ? `, ${p.county} County` : ""})`)
        .join("; ")
    : "";
  const searchTerms = [
    input.companyName,
    ...input.projects.map((p) => p.name),
  ].filter(Boolean);

  return `You are a research assistant for ${input.orgName}, an economic-development network. Search the web for recent news about this member organisation and its projects.
Organization: ${input.companyName}
Contact: ${input.contactName || "(unknown)"}
Industry: ${input.industry || "(unspecified)"}
Region: ${region}${input.website ? `\nWebsite: ${input.website}` : ""}${projectLines}

Search specifically for: "${searchTerms.join('" OR "')}" — regional news, project announcements, permits, capital raises, groundbreakings, and press coverage published in the last 12 months. Only include articles published within the past 12 months; exclude anything older.

Return a JSON array of up to 5 results, ONLY the array — no preamble, no markdown code fences:
[{"headline":"<title>","source":"<publication>","date":"<publication date>","url":"<url or null>","summary":"<2-3 sentences>","significance":"<1 sentence on why this matters for the network>"}]
If nothing relevant is found, return []. Ground every result in a real, verifiable source from your search — do not invent articles.`;
}

/// Scan the web for recent news about one company. Validates output shape and
/// de-dupes. Ephemeral — nothing is stored until the caller saves an article.
export async function scanCompanyNews(
  input: NewsScanInput,
): Promise<NewsArticle[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseNewsArticles(text);
}
