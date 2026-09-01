import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { EnrichArticle, ProjectEnrichContext, ProjectProposal } from "@/lib/project-enrich";

// Action-level integration test for project enrichment. Runs against the real
// Neon DB, mocking only two external seams: Clerk (requireOrgContext) and the
// Anthropic engine (generateProjectEnrichment). Proves proposeProjectUpdates
// assembles THIS project's coverage pool (cross-linked + participant-company
// news, never another tenant's), reports empty when there's none, and refuses a
// foreign id; and that applyProjectUpdates writes only the selected fields,
// appends a stage-history entry on a real stage change, and refuses a foreign id.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project-enrich", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-enrich")>();
  return { ...actual, generateProjectEnrichment: genSpy };
});

const { proposeProjectUpdates, applyProjectUpdates } = await import(
  "@/app/dashboard/projects/enrich-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const projectAId = randomUUID();
const emptyProjectId = randomUUID();
const projectBId = randomUUID();
const companyBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Rondout Partners",
        status: "member",
        industry: "Development",
        annualValue: 1000,
      },
    });
    await tx.project.create({
      data: {
        id: projectAId,
        orgId: orgA.id,
        name: "Kingston Mill",
        stage: "pre_development",
        county: "Ulster",
      },
    });
    // Participant company on the project → its coverage joins the pool.
    await tx.projectLink.create({
      data: {
        orgId: orgA.id,
        projectId: projectAId,
        companyId: companyAId,
        role: "developer",
      },
    });
    // Coverage cross-linked to the project.
    await tx.newsItem.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        projectId: projectAId,
        headline: "Groundbreaking held for Kingston Mill",
        url: "https://example.com/kingston-groundbreaking",
        summary: "Construction began Tuesday.",
        capturedAt: new Date("2026-06-05T12:00:00Z"),
      },
    });
    // Coverage saved to the participant company (no project link) — still pooled.
    await tx.newsItem.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        headline: "Rondout secures $12M financing",
        url: "https://example.com/rondout-financing",
        summary: "",
        capturedAt: new Date("2026-06-04T12:00:00Z"),
      },
    });

    // A project with no coverage at all → propose reports empty.
    await tx.project.create({
      data: { id: emptyProjectId, orgId: orgA.id, name: "Empty Project", stage: "concept" },
    });
  });

  // Org B: its own company + project + coverage — must stay invisible / refused.
  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Beta Corp",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
      },
    });
    await tx.project.create({
      data: { id: projectBId, orgId: orgB.id, name: "Beta Tower", stage: "concept" },
    });
    await tx.newsItem.create({
      data: {
        orgId: orgB.id,
        companyId: companyBId,
        projectId: projectBId,
        headline: "Beta Tower breaks ground",
        url: "https://example.com/beta-tower",
        summary: "Do not leak.",
        capturedAt: new Date("2026-06-06T12:00:00Z"),
      },
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
  genSpy.mockReset();
});

describe("proposeProjectUpdates", () => {
  test("assembles this project's coverage pool for the model", async () => {
    const proposals: ProjectProposal[] = [
      {
        field: "stage",
        label: "Stage",
        currentValue: "pre_development",
        proposedValue: "under_construction",
        reason: "groundbreaking",
        confidence: "high",
      },
    ];
    genSpy.mockResolvedValue(proposals);

    const result = await proposeProjectUpdates(projectAId);
    expect(result).toEqual({ status: "ok", proposals });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as ProjectEnrichContext;
    const feedArticles = genSpy.mock.calls[0][1] as EnrichArticle[];

    expect(context.name).toBe("Kingston Mill");
    expect(context.stage).toBe("pre_development");
    expect(context.county).toBe("Ulster");

    // Both the cross-linked and participant-company articles are pooled; the
    // other tenant's coverage never appears.
    const headlines = feedArticles.map((a) => a.headline);
    expect(headlines).toContain("Groundbreaking held for Kingston Mill");
    expect(headlines).toContain("Rondout secures $12M financing");
    expect(headlines).not.toContain("Beta Tower breaks ground");
  });

  test("reports empty when the project has no coverage", async () => {
    const result = await proposeProjectUpdates(emptyProjectId);
    expect(result).toEqual({ status: "empty" });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("reports empty when the model returns no usable proposals", async () => {
    genSpy.mockResolvedValue([]);
    const result = await proposeProjectUpdates(projectAId);
    expect(result).toEqual({ status: "empty" });
  });

  test("refuses a project id from another tenant (RLS → not found)", async () => {
    const result = await proposeProjectUpdates(projectBId);
    expect(result).toEqual({
      status: "error",
      message: "project not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("applyProjectUpdates", () => {
  test("writes selected fields and appends a stage-history entry", async () => {
    const result = await applyProjectUpdates(projectAId, [
      { field: "stage", value: "under_construction" },
      { field: "value", value: "$12,000,000" },
      { field: "units", value: "80" },
    ]);
    expect(result).toEqual({ status: "applied", count: 3 });

    const project = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({
        where: { id: projectAId },
        select: { stage: true, value: true, units: true, stageHistory: true },
      }),
    );
    expect(project!.stage).toBe("under_construction");
    expect(Number(project!.value)).toBe(12000000);
    expect(project!.units).toBe(80);
    const history = project!.stageHistory as Array<{ stage: string }>;
    expect(history.at(-1)?.stage).toBe("under_construction");
  });

  test("drops out-of-vocab and malformed values before writing", async () => {
    const result = await applyProjectUpdates(projectAId, [
      { field: "stage", value: "groundbreaking" },
      { field: "sqft", value: "lots" },
      { field: "county", value: "Dutchess" },
    ]);
    // Only county survives validation.
    expect(result).toEqual({ status: "applied", count: 1 });

    const project = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id: projectAId }, select: { county: true, stage: true } }),
    );
    expect(project!.county).toBe("Dutchess");
    // Stage untouched by the bogus value.
    expect(project!.stage).toBe("under_construction");
  });

  test("rejects an empty selection", async () => {
    const result = await applyProjectUpdates(projectAId, []);
    expect(result).toEqual({ status: "error", message: "Nothing selected to apply." });
  });

  test("refuses to write to another tenant's project (RLS → not found)", async () => {
    const result = await applyProjectUpdates(projectBId, [
      { field: "county", value: "Leaked" },
    ]);
    expect(result).toEqual({
      status: "error",
      message: "project not found in this organization",
    });

    const projectB = await withOrg(orgB.id, (tx) =>
      tx.project.findUnique({ where: { id: projectBId }, select: { county: true } }),
    );
    expect(projectB!.county).toBeNull();
  });
});
