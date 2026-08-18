import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { parseAssistanceKeys } from "@/lib/project-assistance";

// Action-level integration test for updateProjectAssistance: writes the selected
// assistance keys, drops out-of-vocab keys at the boundary, clears when none are
// selected, refuses a foreign-tenant project, and stays tenant-isolated. Runs
// against the real Neon DB, mocking only Clerk and Next's revalidatePath.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { createProject, updateProjectAssistance } = await import(
  "@/app/dashboard/projects/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

beforeAll(async () => {
  await prisma.organization.create({ data: { ...orgA, orgType: "edc" } });
  await prisma.organization.create({ data: { ...orgB, orgType: "edc" } });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function fd(projectId: string, assistance: string[]): FormData {
  const f = new FormData();
  f.set("projectId", projectId);
  for (const a of assistance) f.append("assistance", a);
  return f;
}

async function makeProject(orgId: string): Promise<string> {
  const prev = mockCtx.orgId;
  mockCtx.orgId = orgId;
  const name = `Assistance ${randomUUID()}`;
  await createProject((() => {
    const f = new FormData();
    f.set("name", name);
    f.set("stage", "concept");
    return f;
  })());
  mockCtx.orgId = prev;
  const p = await withOrg(orgId, (tx) =>
    tx.project.findFirst({ where: { name }, select: { id: true } }),
  );
  return p!.id;
}

async function readKeys(id: string): Promise<string[]> {
  const row = await withOrg(orgA.id, (tx) =>
    tx.project.findUnique({ where: { id }, select: { assistanceRequested: true } }),
  );
  return parseAssistanceKeys(row!.assistanceRequested);
}

describe("updateProjectAssistance", () => {
  test("writes the selected assistance keys", async () => {
    const id = await makeProject(orgA.id);
    await updateProjectAssistance(fd(id, ["equity_sourcing", "cfa_application", "grants"]));
    expect(await readKeys(id)).toEqual(["equity_sourcing", "grants", "cfa_application"]);
  });

  test("drops out-of-vocab keys at the write boundary", async () => {
    const id = await makeProject(orgA.id);
    await updateProjectAssistance(fd(id, ["ida_navigation", "bogus", ""]));
    expect(await readKeys(id)).toEqual(["ida_navigation"]);
  });

  test("clears the selection when none are provided", async () => {
    const id = await makeProject(orgA.id);
    await updateProjectAssistance(fd(id, ["grants"]));
    expect(await readKeys(id)).toEqual(["grants"]);
    await updateProjectAssistance(fd(id, []));
    expect(await readKeys(id)).toEqual([]);
  });

  test("refuses a project in another tenant (isolation)", async () => {
    const foreignId = await makeProject(orgB.id);
    // Acting as orgA, a foreign project is invisible under RLS.
    await expect(
      updateProjectAssistance(fd(foreignId, ["grants"])),
    ).rejects.toThrow("project not found in this organization");
    const row = await withOrg(orgB.id, (tx) =>
      tx.project.findUnique({
        where: { id: foreignId },
        select: { assistanceRequested: true },
      }),
    );
    expect(parseAssistanceKeys(row!.assistanceRequested)).toEqual([]);
  });
});
