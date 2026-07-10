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

const { scanNews, saveNewsItem, deleteNewsItem } = await import(
  "@/app/dashboard/news/actions"
);

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
});
