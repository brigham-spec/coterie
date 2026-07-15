import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { FundingProjectContext } from "@/lib/funding-engine";

// Action-level integration test for the Funding Sources & Grants slice
// (add/update/updateStatus/delete + the AI suggest seam). Runs against the real
// Neon DB, mocking only Clerk (requireOrgContext), Next's revalidatePath, and the
// Anthropic engine. Proves the field write, the manual-add validation, the inline
// status change, the AI-track create path, that the suggestion is grounded in this
// project, and that a foreign project / funding-source id is refused by RLS with
// the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/funding-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/funding-engine")>();
  return { ...actual, generateFundingSuggestions: genSpy };
});

const {
  addFundingSource,
  updateFundingSource,
  updateFundingStatus,
  deleteFundingSource,
  suggestFundingSources,
} = await import("@/app/dashboard/projects/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// orgA: a project. orgB: its own project + a seeded funding source (foreign targets).
const projectAId = randomUUID();
const projectBId = randomUUID();
const sourceBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.project.create({
      data: {
        id: projectAId,
        orgId: orgA.id,
        name: "Riverfront Lofts",
        stage: "concept",
        county: "Ulster",
        description: "80-unit affordable rental targeting 50% AMI",
        units: 80,
      },
    });
  });

  await withOrg(orgB.id, async (tx) => {
    await tx.project.create({
      data: { id: projectBId, orgId: orgB.id, name: "Foreign Project", stage: "concept" },
    });
    await tx.fundingSource.create({
      data: {
        id: sourceBId,
        orgId: orgB.id,
        projectId: projectBId,
        name: "Foreign Grant",
        category: "Grant",
        status: "Identified",
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

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addFundingSource", () => {
  test("stores the fields (manual add)", async () => {
    await addFundingSource(
      fd({
        projectId: projectAId,
        name: "Restore NY",
        agency: "Empire State Development",
        category: "Grant",
        estimatedBenefit: "Up to $2M",
        status: "Researching",
        notes: "City must sponsor.",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.fundingSource.findFirst({ where: { projectId: projectAId, name: "Restore NY" } }),
    );
    expect(row).not.toBeNull();
    expect(row!.agency).toBe("Empire State Development");
    expect(row!.category).toBe("Grant");
    expect(row!.estimatedBenefit).toBe("Up to $2M");
    expect(row!.status).toBe("Researching");
    expect(row!.notes).toBe("City must sponsor.");
    expect(row!.aiSuggested).toBe(false);
  });

  test("persists an AI-tracked suggestion with aiSuggested=true", async () => {
    await addFundingSource(
      fd({
        projectId: projectAId,
        name: "IDA 421-p PILOT",
        category: "Tax Benefit",
        rationale: "School board opt-in required.",
        action: "Apply to the local IDA.",
        status: "Identified",
        aiSuggested: "true",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.fundingSource.findFirst({
        where: { projectId: projectAId, name: "IDA 421-p PILOT" },
      }),
    );
    expect(row!.aiSuggested).toBe(true);
    expect(row!.category).toBe("Tax Benefit");
    expect(row!.rationale).toBe("School board opt-in required.");
  });

  test("requires a program name", async () => {
    await expect(
      addFundingSource(fd({ projectId: projectAId, category: "Grant" })),
    ).rejects.toThrow("a program name is required");
  });

  test("refuses a foreign project id", async () => {
    await expect(
      addFundingSource(fd({ projectId: projectBId, name: "Sneak Grant" })),
    ).rejects.toThrow("project not found in this organization");
  });
});

describe("updateFundingStatus", () => {
  test("changes the status on an owned row", async () => {
    const row = await withOrg(orgA.id, (tx) =>
      tx.fundingSource.create({
        data: {
          orgId: orgA.id,
          projectId: projectAId,
          name: "SBA 504",
          category: "Loan",
          status: "Identified",
        },
      }),
    );

    await updateFundingStatus(
      fd({ fundingSourceId: row.id, projectId: projectAId, status: "Awarded" }),
    );

    const after = await withOrg(orgA.id, (tx) =>
      tx.fundingSource.findUnique({ where: { id: row.id } }),
    );
    expect(after!.status).toBe("Awarded");
  });

  test("rejects an out-of-vocabulary status", async () => {
    await expect(
      updateFundingStatus(
        fd({ fundingSourceId: sourceBId, projectId: projectBId, status: "Won" }),
      ),
    ).rejects.toThrow("invalid funding status");
  });

  test("refuses a foreign funding-source id and leaves it untouched", async () => {
    await expect(
      updateFundingStatus(
        fd({ fundingSourceId: sourceBId, projectId: projectBId, status: "Awarded" }),
      ),
    ).rejects.toThrow("funding source not found in this organization");

    const untouched = await withOrg(orgB.id, (tx) =>
      tx.fundingSource.findUnique({ where: { id: sourceBId } }),
    );
    expect(untouched!.status).toBe("Identified");
  });
});

describe("updateFundingSource", () => {
  test("refuses a foreign funding-source id", async () => {
    await expect(
      updateFundingSource(
        fd({
          fundingSourceId: sourceBId,
          projectId: projectBId,
          name: "Hijacked",
          category: "Grant",
          status: "Identified",
        }),
      ),
    ).rejects.toThrow("funding source not found in this organization");

    const untouched = await withOrg(orgB.id, (tx) =>
      tx.fundingSource.findUnique({ where: { id: sourceBId } }),
    );
    expect(untouched!.name).toBe("Foreign Grant");
  });
});

describe("deleteFundingSource", () => {
  test("refuses to delete a foreign row (no-op)", async () => {
    await deleteFundingSource(fd({ fundingSourceId: sourceBId, projectId: projectBId }));

    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.fundingSource.findUnique({ where: { id: sourceBId } }),
    );
    expect(stillThere).not.toBeNull();
  });
});

describe("suggestFundingSources", () => {
  test("grounds the engine call in this project and returns suggestions", async () => {
    genSpy.mockResolvedValue([
      {
        name: "9% LIHTC",
        agency: "NY HCR",
        category: "Equity",
        estimatedBenefit: "Deep affordability credit",
        rationale: "80 units at 50% AMI.",
        action: "Prepare the HCR application.",
      },
    ]);

    const state = await suggestFundingSources(
      { status: "idle" },
      fd({ projectId: projectAId }),
    );

    expect(state.status).toBe("ok");
    if (state.status === "ok") {
      expect(state.suggestions).toHaveLength(1);
      expect(state.suggestions[0].name).toBe("9% LIHTC");
    }
    const arg = genSpy.mock.calls[0][0] as FundingProjectContext;
    expect(arg.name).toBe("Riverfront Lofts");
    expect(arg.county).toBe("Ulster");
    expect(arg.units).toBe(80);
  });

  test("refuses a foreign project id (no engine call)", async () => {
    const state = await suggestFundingSources(
      { status: "idle" },
      fd({ projectId: projectBId }),
    );
    expect(state.status).toBe("error");
    if (state.status === "error")
      expect(state.message).toBe("project not found in this organization");
    expect(genSpy).not.toHaveBeenCalled();
  });
});
