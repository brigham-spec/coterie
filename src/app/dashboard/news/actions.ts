"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import {
  excludeSavedArticles,
  scanCompanyNews,
  type NewsArticle,
} from "@/lib/news-scan";

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
    // Articles already saved for this company — filtered out of the scan below
    // so a re-scan doesn't resurface press already in the ledger (cuts noise).
    const saved = await tx.newsItem.findMany({
      where: { companyId },
      select: { url: true },
    });
    return { company, links, savedUrls: saved.map((n) => n.url) };
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
      articles: excludeSavedArticles(articles, company.savedUrls),
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

// Project-scoped news scan (companion to scanNews). Same web-search engine, but
// grounded in ONE project: the subject company is the project's developer (or,
// lacking one, its first participant), and the single project is passed through
// so buildPrompt blends the project name into the search terms. Returns the
// resolved attach company id so the scan card can save an article against a real
// company (news_items.company_id is required) and link it to the project.
export type ProjectNewsScanState =
  | { status: "idle" }
  | {
      status: "ok";
      projectId: string;
      projectName: string;
      attachCompanyId: string | null;
      articles: NewsArticle[];
    }
  | { status: "error"; message: string };

export async function scanProjectNews(
  _prev: ProjectNewsScanState,
  formData: FormData,
): Promise<ProjectNewsScanState> {
  const { orgId, orgName } = await requireOrgContext();

  const projectId = String(formData.get("projectId") ?? "").trim();
  if (projectId === "")
    return { status: "error", message: "Select a project to scan." };

  // RLS scopes the read; a foreign/unknown id resolves to no project.
  const resolved = await withOrg(orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        stage: true,
        county: true,
        industry: true,
        prospectLead: true,
        developer: {
          select: {
            id: true,
            name: true,
            industry: true,
            counties: true,
            website: true,
          },
        },
        projectLinks: {
          orderBy: { role: "asc" },
          take: 1,
          select: {
            company: {
              select: {
                id: true,
                name: true,
                industry: true,
                counties: true,
                website: true,
              },
            },
          },
        },
      },
    });
    if (project === null) return null;
    // Ground the search in the project's developer, falling back to its first
    // participant. Saved articles attach to this company (or none if the project
    // has no associated company — the scan still surfaces results ephemerally).
    const subject = project.developer ?? project.projectLinks[0]?.company ?? null;
    const attachCompanyId = subject?.id ?? null;
    // Articles already saved for this project (or its subject company) — filtered
    // out of the scan below so a re-scan doesn't resurface saved press (cuts noise).
    const saved = await tx.newsItem.findMany({
      where: attachCompanyId
        ? { OR: [{ projectId }, { companyId: attachCompanyId }] }
        : { projectId },
      select: { url: true },
    });
    return {
      project,
      subject,
      attachCompanyId,
      savedUrls: saved.map((n) => n.url),
    };
  });

  if (resolved === null)
    return { status: "error", message: "Project not found in this organization." };

  const { project, subject, attachCompanyId, savedUrls } = resolved;
  const companyName = subject?.name ?? project.prospectLead ?? project.name;
  const counties = subject?.counties ?? (project.county ? [project.county] : []);

  try {
    await enforceAiRateLimit(orgId);
    const articles = await scanCompanyNews({
      orgName,
      companyName,
      contactName: "",
      industry: subject?.industry ?? project.industry ?? "",
      counties,
      website: subject?.website ?? null,
      projects: [
        { name: project.name, stage: project.stage, county: project.county ?? "" },
      ],
    });
    return {
      status: "ok",
      projectId: project.id,
      projectName: project.name,
      attachCompanyId,
      articles: excludeSavedArticles(articles, savedUrls),
    };
  } catch (err) {
    console.error("project news scan failed", err);
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

const MAX_FACTS = 5;
const FACT_MAX_LEN = 120;

// Coerce the scan card's JSON-encoded keyFacts payload into a bounded string[].
// Trusts nothing: non-JSON, non-array, and non-string entries all collapse to an
// empty list, and each fact is trimmed and length-capped.
function parseKeyFacts(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((f): f is string => typeof f === "string")
    .map((f) => f.trim().slice(0, FACT_MAX_LEN))
    .filter((f) => f !== "")
    .slice(0, MAX_FACTS);
}

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
  // Optional: when saving from a project scan, link the new item to that project
  // in the same write (news_items.project_id is a plain FK, re-verified below).
  const projectId = String(formData.get("projectId") ?? "").trim();
  // The scan card ships the article's AI-extracted facts as a JSON array; a bad
  // or absent value just persists no facts (they're display-only chips).
  const keyFacts = parseKeyFacts(formData.get("keyFacts"));
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

      // Re-verify the project belongs to THIS org before pinning it (plain FK,
      // mirrors linkNewsToProject) so a crafted request can't cross-link.
      if (projectId !== "") {
        const project = await tx.project.findUnique({
          where: { id: projectId },
          select: { id: true },
        });
        if (project === null)
          return { status: "error" as const, message: "Project not found." };
      }

      const existing = await tx.newsItem.findFirst({
        where: { companyId, url },
        select: { id: true, projectId: true },
      });
      if (existing) {
        // Already saved for this company; if this save came from a project scan
        // and the item isn't linked to that project yet, pin it now.
        if (projectId !== "" && existing.projectId !== projectId)
          await tx.newsItem.updateMany({
            where: { id: existing.id },
            data: { projectId },
          });
        return { status: "exists" as const };
      }

      await tx.newsItem.create({
        data: {
          orgId,
          companyId,
          projectId: projectId === "" ? null : projectId,
          headline,
          url,
          summary: summary || null,
          keyFacts,
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
    // The company profile's Saved Articles card reads the same ledger.
    revalidatePath(`/dashboard/companies/${companyId}`);
    // A project scan saves against the project's Press & News card too.
    if (projectId !== "") revalidatePath(`/dashboard/projects/${projectId}`);
  }
}

export async function deleteNewsItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("article required");
  // Passed when removing from a company profile, so that card re-renders too.
  const companyId = String(formData.get("companyId") ?? "").trim();

  await withOrg(orgId, (tx) => tx.newsItem.deleteMany({ where: { id } }));
  revalidatePath("/dashboard/news");
  if (companyId !== "") revalidatePath(`/dashboard/companies/${companyId}`);
}

export type UpdateNoteResult =
  | { status: "saved" }
  | { status: "error"; message: string };

// Save (or clear) a saved article's free-text note (News audit item 6). An empty
// note clears the field. RLS scopes the update — a foreign id matches no row and
// affects nothing, surfaced to the caller as a not-found error.
export async function updateNewsNote(
  formData: FormData,
): Promise<UpdateNoteResult> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") return { status: "error", message: "Missing article." };
  const companyId = String(formData.get("companyId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const updated = await withOrg(orgId, (tx) =>
    tx.newsItem.updateMany({
      where: { id },
      data: { note: note === "" ? null : note },
    }),
  );
  if (updated.count === 0)
    return { status: "error", message: "Article not found in this organization." };

  revalidatePath("/dashboard/news");
  if (companyId !== "") revalidatePath(`/dashboard/companies/${companyId}`);
  return { status: "saved" };
}

// Cross-link (or clear the link of) a saved article to a project (News audit
// item 5). A blank projectId unlinks. news_items.project_id is a plain SetNull
// FK — RLS WITH CHECK only guards our own org_id — so re-verify the target
// project belongs to THIS org inside the tx before pinning it (mirrors
// saveNewsItem's company re-verification). RLS scopes the update, so a foreign
// article id matches no row and affects nothing.
export async function linkNewsToProject(
  formData: FormData,
): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("article required");
  const companyId = String(formData.get("companyId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();

  await withOrg(orgId, async (tx) => {
    if (projectId !== "") {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (project === null)
        throw new Error("Project not found in this organization.");
    }
    await tx.newsItem.updateMany({
      where: { id },
      data: { projectId: projectId === "" ? null : projectId },
    });
  });

  revalidatePath("/dashboard/news");
  if (companyId !== "") revalidatePath(`/dashboard/companies/${companyId}`);
  if (projectId !== "") revalidatePath(`/dashboard/projects/${projectId}`);
}
