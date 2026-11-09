import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { NewsScanInput } from "@/lib/news-scan";

// Action-level integration test for News Intelligence (slice 11.9). Exercises the
// server actions against the real Neon DB, mocking only the external seams:
//   • scanNews: mock Clerk + the web-search engine, assert the company CONTEXT
//     handed to the engine is tenant-scoped (own company, its primary contact and
//     ACTIVE projects only) and that a foreign id is refused.
//   • saveNewsItem / deleteNewsItem: NOT mocked — prove a real NewsItem persists
//     in the caller's tenant, dedupes by (companyId,url), and stays invisible to
//     another tenant (RLS).

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const scanSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/news-scan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/news-scan")>();
  return { ...actual, scanCompanyNews: scanSpy };
});

// The pasted-link enrichment seam does a live web fetch + AI summary; mock it so
// the action tests stay hermetic. Defaults to "no summary found" (the common
// path when a URL can't be read), which leaves the saved row's summary untouched;
// individual tests override it per-call to exercise the enriched path.
const summarizeSpy = vi.hoisted(() =>
  vi.fn<
    (url: string) => Promise<import("@/lib/news-link").ArticleSummary | null>
  >(async () => null),
);
vi.mock("@/lib/news-link", () => ({ summarizeArticleLink: summarizeSpy }));

const { scanNews, saveNewsItem, deleteNewsItem, updateNewsNote, linkNewsToProject } =
  await import("@/app/dashboard/news/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

let companyAId = "";

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Riverside Mills",
        status: "member",
        industry: "Developer",
        annualValue: 1000,
        counties: ["Ulster", "Dutchess"],
        website: "https://riverside.example",
        contacts: {
          create: { orgId: orgA.id, name: "Pat Rivera", isPrimary: true },
        },
      },
    });
    companyAId = company.id;

    const active = await tx.project.create({
      data: { orgId: orgA.id, name: "Mill Redevelopment", stage: "concept", county: "Ulster" },
    });
    const done = await tx.project.create({
      data: { orgId: orgA.id, name: "Old Warehouse", stage: "completed", county: "Ulster" },
    });
    await tx.projectLink.createMany({
      data: [
        { orgId: orgA.id, projectId: active.id, companyId: company.id, role: "developer" },
        { orgId: orgA.id, projectId: done.id, companyId: company.id, role: "developer" },
      ],
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  scanSpy.mockReset();
  summarizeSpy.mockReset();
  summarizeSpy.mockResolvedValue(null);
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("scanNews action", () => {
  test("hands the engine the caller's scoped company context (active projects only)", async () => {
    scanSpy.mockResolvedValue([]);

    const state = await scanNews({ status: "idle" }, fd({ companyId: companyAId }));
    expect(state).toEqual({
      status: "ok",
      companyId: companyAId,
      companyName: "Riverside Mills",
      articles: [],
    });

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const input = scanSpy.mock.calls[0][0] as NewsScanInput;
    expect(input.orgName).toBe(orgA.name);
    expect(input.companyName).toBe("Riverside Mills");
    expect(input.contactName).toBe("Pat Rivera");
    expect(input.industry).toBe("Developer");
    expect(input.counties).toEqual(["Ulster", "Dutchess"]);
    expect(input.website).toBe("https://riverside.example");
    // Only the ACTIVE project is grounding context — the completed one is dropped.
    expect(input.projects.map((p) => p.name)).toEqual(["Mill Redevelopment"]);
  });

  test("refuses an empty or foreign company id", async () => {
    const empty = await scanNews({ status: "idle" }, fd({ companyId: "" }));
    expect(empty).toEqual({ status: "error", message: "Select a company to scan." });

    const foreign = await scanNews({ status: "idle" }, fd({ companyId: randomUUID() }));
    expect(foreign).toEqual({
      status: "error",
      message: "Company not found in this organization.",
    });
    // The engine is never called for an id RLS can't resolve.
    expect(scanSpy).not.toHaveBeenCalled();
  });

  test("surfaces an engine failure as inline error state", async () => {
    scanSpy.mockRejectedValue(new Error("boom"));
    const state = await scanNews({ status: "idle" }, fd({ companyId: companyAId }));
    expect(state).toEqual({ status: "error", message: "Could not scan for news. Try again." });
  });
});

describe("saveNewsItem / deleteNewsItem actions", () => {
  test("persists an article, dedupes by (company,url), then deletes", async () => {
    const article = {
      companyId: companyAId,
      headline: "Riverside lands $40M for mill redevelopment",
      url: "https://hvbj.example/riverside-40m",
      summary: "The developer closed financing for the Kingston mill project.",
    };

    const first = await saveNewsItem(fd(article));
    expect(first).toEqual({ status: "saved" });

    const saved = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findFirst({ where: { companyId: companyAId } }),
    );
    expect(saved?.headline).toBe(article.headline);
    expect(saved?.url).toBe(article.url);
    expect(saved?.summary).toBe(article.summary);

    // Re-saving the same (company,url) is a no-op.
    const again = await saveNewsItem(fd(article));
    expect(again).toEqual({ status: "exists" });

    const count = await withOrg(orgA.id, (tx) =>
      tx.newsItem.count({ where: { companyId: companyAId } }),
    );
    expect(count).toBe(1);

    // Delete removes it.
    await deleteNewsItem(fd({ id: saved!.id }));
    const after = await withOrg(orgA.id, (tx) =>
      tx.newsItem.count({ where: { companyId: companyAId } }),
    );
    expect(after).toBe(0);
  });

  test("a saved article is invisible to another tenant (RLS)", async () => {
    await saveNewsItem(
      fd({
        companyId: companyAId,
        headline: "Tenant-scoped headline",
        url: "https://x.example/scoped",
        summary: "",
      }),
    );

    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.newsItem.findMany({ where: { headline: "Tenant-scoped headline" } }),
    );
    expect(seenByB).toEqual([]);
  });

  test("persists keyFacts from the scan card and edits/clears the note", async () => {
    const saved = await saveNewsItem(
      fd({
        companyId: companyAId,
        headline: "Article with facts",
        url: "https://x.example/facts",
        summary: "",
        keyFacts: JSON.stringify(["$40M raise", "120 jobs"]),
      }),
    );
    expect(saved).toEqual({ status: "saved" });

    const row = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findFirst({ where: { url: "https://x.example/facts" } }),
    );
    expect(row?.keyFacts).toEqual(["$40M raise", "120 jobs"]);
    expect(row?.note).toBeNull();

    // Set a note, then clear it.
    const noted = await updateNewsNote(
      fd({ id: row!.id, companyId: companyAId, note: "Follow up with Pat" }),
    );
    expect(noted).toEqual({ status: "saved" });
    const withNote = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findUnique({ where: { id: row!.id } }),
    );
    expect(withNote?.note).toBe("Follow up with Pat");

    const cleared = await updateNewsNote(
      fd({ id: row!.id, companyId: companyAId, note: "" }),
    );
    expect(cleared).toEqual({ status: "saved" });
    const afterClear = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findUnique({ where: { id: row!.id } }),
    );
    expect(afterClear?.note).toBeNull();

    await deleteNewsItem(fd({ id: row!.id }));
  });

  test("updateNewsNote refuses a foreign article id (RLS)", async () => {
    const result = await updateNewsNote(
      fd({ id: randomUUID(), companyId: companyAId, note: "nope" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Article not found in this organization.",
    });
  });

  test("saves a link-less article (no citable source), deduped by headline", async () => {
    const article = {
      companyId: companyAId,
      headline: "Scan find the model couldn't link",
      summary: "Real content, no source URL.",
      keyFacts: JSON.stringify(["$12M", "80 units"]),
    };

    const first = await saveNewsItem(fd(article));
    expect(first).toEqual({ status: "saved" });
    // No URL was present, so the enrichment seam is never consulted.
    expect(summarizeSpy).not.toHaveBeenCalled();

    const row = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findFirst({ where: { headline: article.headline } }),
    );
    expect(row?.url).toBeNull();
    expect(row?.summary).toBe(article.summary);
    expect(row?.keyFacts).toEqual(["$12M", "80 units"]);

    // Re-saving the same (company,headline) with no URL is a no-op.
    const again = await saveNewsItem(fd(article));
    expect(again).toEqual({ status: "exists" });
    const count = await withOrg(orgA.id, (tx) =>
      tx.newsItem.count({ where: { headline: article.headline } }),
    );
    expect(count).toBe(1);

    await deleteNewsItem(fd({ id: row!.id }));
  });

  test("rejects a missing headline", async () => {
    const result = await saveNewsItem(
      fd({ companyId: companyAId, url: "https://x.example/no-headline" }),
    );
    expect(result).toEqual({ status: "error", message: "Missing article details." });
  });

  test("rejects a non-http(s) url but allows a link-less save", async () => {
    const bad = await saveNewsItem(
      fd({ companyId: companyAId, headline: "Bad scheme", url: "ftp://x.example/f" }),
    );
    expect(bad).toEqual({
      status: "error",
      message: "Article link must be an http(s) URL.",
    });
  });

  test("enriches a bare pasted link via the summary seam", async () => {
    summarizeSpy.mockResolvedValueOnce({
      headline: "Fetched: Kingston approves waterfront plan",
      summary: "The planning board approved the project on Tuesday.",
      keyFacts: ["approved", "waterfront"],
    });
    const url = "https://x.example/paste-enrich";

    // The manual "Add link" path sends headline === url (its URL fallback) and an
    // empty summary — the enrichment then fills summary/facts and replaces the
    // placeholder headline.
    const saved = await saveNewsItem(
      fd({ companyId: companyAId, headline: url, url, summary: "" }),
    );
    expect(saved).toEqual({ status: "saved" });
    expect(summarizeSpy).toHaveBeenCalledWith(url);

    const row = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findFirst({ where: { url } }),
    );
    expect(row?.headline).toBe("Fetched: Kingston approves waterfront plan");
    expect(row?.summary).toBe("The planning board approved the project on Tuesday.");
    expect(row?.keyFacts).toEqual(["approved", "waterfront"]);

    await deleteNewsItem(fd({ id: row!.id }));
  });
});

describe("saveNewsItem project-only (no company)", () => {
  let projectId = "";

  beforeAll(async () => {
    mockCtx.orgId = orgA.id;
    const project = await withOrg(orgA.id, (tx) =>
      tx.project.create({
        data: { orgId: orgA.id, name: "Caught Wind Of", stage: "concept" },
      }),
    );
    projectId = project.id;
  });

  afterAll(async () => {
    mockCtx.orgId = orgA.id;
    await withOrg(orgA.id, async (tx) => {
      await tx.newsItem.deleteMany({ where: { projectId } });
      await tx.project.deleteMany({ where: { id: projectId } });
    });
  });

  test("saves a link against a project with no company, deduped by (project,url)", async () => {
    const article = {
      projectId,
      headline: "Early buzz about the site",
      url: "https://x.example/early-buzz",
      summary: "Heard about it before any developer is attached.",
    };

    const first = await saveNewsItem(fd(article));
    expect(first).toEqual({ status: "saved" });

    const row = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findFirst({ where: { projectId } }),
    );
    expect(row?.companyId).toBeNull();
    expect(row?.projectId).toBe(projectId);
    expect(row?.headline).toBe(article.headline);

    // Re-saving the same (project,url) is a no-op.
    const again = await saveNewsItem(fd(article));
    expect(again).toEqual({ status: "exists" });
    const count = await withOrg(orgA.id, (tx) =>
      tx.newsItem.count({ where: { projectId } }),
    );
    expect(count).toBe(1);
  });

  test("refuses a link with neither a company nor a project", async () => {
    const result = await saveNewsItem(
      fd({ headline: "Orphan", url: "https://x.example/orphan" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "A link needs a company or a project.",
    });
  });

  test("a project-only article is invisible to another tenant (RLS)", async () => {
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.newsItem.findMany({ where: { url: "https://x.example/early-buzz" } }),
    );
    expect(seenByB).toEqual([]);
  });
});

describe("linkNewsToProject action", () => {
  let articleId = "";
  let projectId = "";

  beforeAll(async () => {
    await withOrg(orgA.id, async (tx) => {
      const project = await tx.project.create({
        data: { orgId: orgA.id, name: "Link Target", stage: "concept" },
      });
      projectId = project.id;
      const article = await tx.newsItem.create({
        data: {
          orgId: orgA.id,
          companyId: companyAId,
          headline: "Linkable coverage",
          url: "https://x.example/linkable",
          capturedAt: new Date(),
        },
      });
      articleId = article.id;
    });
  });

  afterAll(async () => {
    mockCtx.orgId = orgA.id;
    await withOrg(orgA.id, async (tx) => {
      await tx.newsItem.deleteMany({ where: { id: articleId } });
      await tx.project.deleteMany({ where: { id: projectId } });
    });
  });

  test("pins an article to an in-org project, then unlinks it", async () => {
    await linkNewsToProject(fd({ id: articleId, companyId: companyAId, projectId }));
    const linked = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findUnique({ where: { id: articleId } }),
    );
    expect(linked?.projectId).toBe(projectId);

    // A blank projectId unlinks.
    await linkNewsToProject(fd({ id: articleId, companyId: companyAId, projectId: "" }));
    const unlinked = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findUnique({ where: { id: articleId } }),
    );
    expect(unlinked?.projectId).toBeNull();
  });

  test("refuses a foreign/unknown project id", async () => {
    await expect(
      linkNewsToProject(
        fd({ id: articleId, companyId: companyAId, projectId: randomUUID() }),
      ),
    ).rejects.toThrow("Project not found in this organization.");
  });

  test("another tenant cannot link this article (RLS)", async () => {
    const projectB = await withOrg(orgB.id, (tx) =>
      tx.project.create({
        data: { orgId: orgB.id, name: "Org B Project", stage: "concept" },
      }),
    );

    mockCtx.orgId = orgB.id;
    // orgB's own project resolves, but the article belongs to orgA — RLS scopes
    // the update to no rows, so orgA's article is untouched.
    await linkNewsToProject(
      fd({ id: articleId, companyId: "", projectId: projectB.id }),
    );
    mockCtx.orgId = orgA.id;

    const stillNull = await withOrg(orgA.id, (tx) =>
      tx.newsItem.findUnique({ where: { id: articleId } }),
    );
    expect(stillNull?.projectId).toBeNull();

    await withOrg(orgB.id, (tx) =>
      tx.project.deleteMany({ where: { id: projectB.id } }),
    );
  });
});
