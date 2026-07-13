"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import { scanCompanyNews, type NewsArticle } from "@/lib/news-scan";

// News Intelligence actions (slice 11.9). scanNews loads ONE company's context
// in a withOrg tx (RLS scopes it — a foreign id resolves to no company) and hands
// it to the web-search engine, which discovers recent press. saveNewsItem
// persists a chosen article to the NewsItem ledger (re-verifying the company
// inside the tx and de-duping by URL) — the only durable effect; the scan itself
// is ephemeral. deleteNewsItem drops a saved article. scanNews is
// useActionState-style so failures render inline.

export type NewsScanState =
  | { status: "idle" }
  | { status: "ok"; companyId: string; companyName: string; articles: NewsArticle[] }
  | { status: "error"; message: string };

export async function scanNews(
  _prev: NewsScanState,
  formData: FormData,
): Promise<NewsScanState> {
  const { orgId, orgName } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  if (companyId === "")
    return { status: "error", message: "Select a company to scan." };

  // RLS scopes the reads; a foreign/unknown id resolves to no company.
  const company = await withOrg(orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        industry: true,
        counties: true,
        website: true,
        contacts: {
          where: { isPrimary: true },
          select: { name: true },
          take: 1,
        },
      },
    });
    if (company === null) return null;
    // This company's active projects give the search extra grounding.
    const links = await tx.projectLink.findMany({
      where: { companyId },
      select: {
        project: {
          select: { name: true, stage: true, county: true },
        },
      },
    });
    return { company, links };
  });

  if (company === null)
    return { status: "error", message: "Company not found in this organization." };

  const projects = company.links
    .map((l) => l.project)
    .filter((p) => !TERMINAL_STAGES.includes(p.stage))
    .map((p) => ({ name: p.name, stage: p.stage, county: p.county ?? "" }));

  try {
    await enforceAiRateLimit(orgId);
    const articles = await scanCompanyNews({
      orgName,
      companyName: company.company.name,
      contactName: company.company.contacts[0]?.name ?? "",
      industry: company.company.industry,
      counties: company.company.counties,
      website: company.company.website,
      projects,
    });
    return {
      status: "ok",
      companyId: company.company.id,
      companyName: company.company.name,
      articles,
    };
  } catch (err) {
    console.error("news scan failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not scan for news. Try again." };
  }
}

export type SaveNewsResult =
  | { status: "saved" }
  | { status: "exists" }
  | { status: "error"; message: string };

// Persist one discovered article to the NewsItem ledger. Re-verifies the company
// belongs to THIS org inside the tx (news_items.company_id is a plain FK — RLS
// WITH CHECK only guards our own org_id, so without this a crafted request could
// attach an own-org item to another org's company id). Deduped by (companyId,url).
export async function saveNewsItem(formData: FormData): Promise<SaveNewsResult> {
  const { orgId } = await requireOrgContext();

  const companyId = String(formData.get("companyId") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (companyId === "" || headline === "" || url === "")
    return { status: "error", message: "Missing article details." };
  // The URL is later rendered as a clickable href, so only http(s) links may be
  // stored — a `javascript:`/`data:` scheme would be a stored-XSS vector.
  if (!/^https?:\/\//i.test(url))
    return { status: "error", message: "Article link must be an http(s) URL." };

  try {
    return await withOrg(orgId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      });
      if (company === null)
        return { status: "error" as const, message: "Company not found." };

      const existing = await tx.newsItem.findFirst({
        where: { companyId, url },
        select: { id: true },
      });
      if (existing) return { status: "exists" as const };

      await tx.newsItem.create({
        data: {
          orgId,
          companyId,
          headline,
          url,
          summary: summary || null,
          capturedAt: new Date(),
        },
      });
      return { status: "saved" as const };
    });
  } catch (err) {
    console.error("save news item failed", err);
    return { status: "error", message: "Could not save this article." };
  } finally {
    revalidatePath("/dashboard/news");
  }
}

export async function deleteNewsItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("article required");

  await withOrg(orgId, (tx) => tx.newsItem.deleteMany({ where: { id } }));
  revalidatePath("/dashboard/news");
}
