import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { withAiRetry } from "@/lib/ai-retry";
import { extractJsonObject } from "@/lib/json-extract";

// Pasted-link enrichment. When an operator saves a bare URL to the news ledger
// (the manual "Add link" boxes on the company profile, the org News page, and a
// project), the stored row has no summary — so "Review updates from news" has
// nothing to read and the ledger entry is just a link. This seam fetches the
// page server-side, strips it to text, and asks Claude for a short summary +
// key facts so the saved article carries real content. Server-only: the fetch
// and the Anthropic key stay off the browser. Best-effort — every failure path
// returns null so the caller still saves the bare link.

// Bound the server-side fetch so a slow or huge page can't hang the save.
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 750_000;
// How much page text we hand the model. A tight cap keeps the prompt cheap; the
// lede of an article carries the facts we need.
const MAX_TEXT = 8_000;
const MAX_REDIRECTS = 3;
const MAX_FACTS = 5;
const FACT_MAX_LEN = 120;

export type ArticleSummary = {
  headline: string;
  summary: string;
  keyFacts: string[];
};

// PURE: is this a public http(s) URL we're willing to fetch server-side? Blocks
// non-http(s) schemes and obvious internal hosts (loopback, link-local, private
// RFC-1918 ranges, *.internal, and the cloud metadata IP) so a saved link can't
// turn our server into an SSRF proxy for the operator's internal network. DNS
// rebinding isn't covered (the hostname may still resolve to a private IP) — an
// accepted residual for an authenticated admin tool.
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  // URL.hostname brackets an IPv6 literal ([fe80::1]); strip them so the
  // literal-IP checks below see the bare address.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".internal") || host.endsWith(".local")) return false;

  // Literal IPv4 private / loopback / link-local ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local + metadata 169.254.169.254
    if (a >= 224) return false; // multicast / reserved
  }
  // IPv6 loopback / link-local / unique-local (brackets already stripped).
  if (host === "::1") return false;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return false;

  return true;
}

// PURE: reduce an HTML document to readable plain text. Drops script/style/head
// noise and tags, decodes the handful of common entities, collapses whitespace,
// and bounds the length. Crude by design — the model tolerates imperfect text,
// and we avoid a heavyweight HTML dependency.
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

// PURE: pull a document title from <title> or og:title, bounded. "" when absent.
export function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og) return decodeEntities(og[1]).replace(/\s+/g, " ").trim().slice(0, 200);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return decodeEntities(t[1]).replace(/\s+/g, " ").trim().slice(0, 200);
  return "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      // Skip the surrogate range (0xD800-0xDFFF) — fromCodePoint throws on it.
      const safe =
        code > 0 && code < 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return safe ? String.fromCodePoint(code) : " ";
    });
}

// Fetch a URL and return its title + readable text, or null on any failure
// (unfetchable/private host, non-HTML, timeout, oversize, network error).
// Follows a bounded number of redirects, re-validating each hop's host so a
// public URL can't bounce the request onto an internal one.
export async function fetchArticlePage(
  url: string,
): Promise<{ title: string; text: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(current)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "CoterieNewsBot/1.0", accept: "text/html" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    // Manual redirect: re-validate the next hop's host, then continue.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc === null) return null;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml"))
      return null;

    const html = await readCapped(res, MAX_BYTES);
    if (html === null) return null;
    return { title: extractTitle(html), text: htmlToText(html) };
  }
  return null;
}

// Read a response body up to maxBytes, aborting (returning null) if it exceeds
// the cap — so a giant page can't blow out memory.
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const body = res.body;
  if (body === null) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const SYSTEM_PROMPT = `You summarize a single news/web article for an economic-development CRM. You ONLY use facts present in the provided page text. You NEVER invent details. If the text is navigation, a paywall, or otherwise not a real article, return empty fields.`;

// PURE: build the user prompt from a page's title + text.
export function buildSummaryPrompt(title: string, text: string): string {
  return `Summarize this article.

TITLE: ${title || "(none)"}

PAGE TEXT:
${text}

Return ONLY a JSON object (no markdown, no prose):
{"headline":"<the article's title, concise>","summary":"<2-3 sentence summary>","keyFacts":["<up to 3 short concrete facts: dollar amounts, dates, counts, square footage>"]}
If the text is not a real article, return {"headline":"","summary":"","keyFacts":[]}.`;
}

// PURE: parse the model's completion into a bounded ArticleSummary. Robust to
// fences/prose and bad shapes — anything unusable collapses to empty fields.
export function parseArticleSummary(raw: string): ArticleSummary {
  const empty: ArticleSummary = { headline: "", summary: "", keyFacts: [] };
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
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const keyFacts = Array.isArray(o.keyFacts)
    ? o.keyFacts
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim().slice(0, FACT_MAX_LEN))
        .filter((f) => f !== "")
        .slice(0, MAX_FACTS)
    : [];
  return {
    headline: str(o.headline, 200),
    summary: str(o.summary, 1000),
    keyFacts,
  };
}

// Fetch a pasted link and summarize it. Returns null when the page can't be
// fetched or yields no usable text; the caller then saves the bare link. The AI
// call is the caller's responsibility to rate-limit (enforceAiRateLimit) before
// invoking, same as the other paid seams.
export async function summarizeArticleLink(
  url: string,
): Promise<ArticleSummary | null> {
  const page = await fetchArticlePage(url);
  if (page === null || page.text === "") return null;

  const client = new Anthropic();
  const response = await withAiRetry(() =>
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildSummaryPrompt(page.title, page.text) },
      ],
    }),
  );
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const parsed = parseArticleSummary(text);
  // Fall back to the page's own <title> if the model gave no headline.
  if (parsed.headline === "" && page.title !== "")
    parsed.headline = page.title.slice(0, 200);
  if (parsed.headline === "" && parsed.summary === "" && parsed.keyFacts.length === 0)
    return null;
  return parsed;
}
