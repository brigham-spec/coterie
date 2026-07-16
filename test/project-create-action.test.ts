import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for createProject's field parity (slice
// project-sqft): proves the pipeline metrics that gained parity with the
// prototype — gross square footage (sqft) and Developer/Lead (prospectLead) —
// persist on create, and that a non-integer sqft is rejected at the boundary.
// Runs against the real Neon DB, mocking only Clerk and Next's revalidatePath.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { createProject } = await import("@/app/dashboard/projects/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };

beforeAll(async () => {
  await prisma.organization.create({ data: { ...orgA, orgType: "edc" } });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: orgA.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createProject field parity", () => {
  test("writes sqft and prospectLead alongside the core fields", async () => {
    const name = `Riverfront ${randomUUID()}`;
    await createProject(
      fd({
        name,
        stage: "concept",
        sqft: "120000",
        prospectLead: "Hudson River Partners",
      }),
    );

    const created = await withOrg(orgA.id, (tx) =>
      tx.project.findFirst({
        where: { name },
        select: { sqft: true, prospectLead: true },
      }),
    );
    expect(created!.sqft).toBe(120000);
    expect(created!.prospectLead).toBe("Hudson River Partners");
  });

  test("rejects a non-integer square footage", async () => {
    await expect(
      createProject(fd({ name: `Bad ${randomUUID()}`, stage: "concept", sqft: "12.5" })),
    ).rejects.toThrow("square footage must be a whole number");
  });

  test("seeds stage_history with the founding stage", async () => {
    const name = `Seeded ${randomUUID()}`;
    await createProject(fd({ name, stage: "concept" }));

    const created = await withOrg(orgA.id, (tx) =>
      tx.project.findFirst({ where: { name }, select: { stageHistory: true } }),
    );
    const history = created!.stageHistory as Array<{ stage: string; date: string }>;
    expect(history).toHaveLength(1);
    expect(history[0].stage).toBe("concept");
    expect(history[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
