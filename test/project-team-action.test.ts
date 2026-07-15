import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the Professional Team roster slice
// (add/update/remove project_team_members). Runs against the real Neon DB,
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// field write, the role/name validation at the boundary, the optional CRM
// company link (same-org enforced), and that a foreign project / member /
// company id is refused by RLS with the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { addTeamMember, updateTeamMember, removeTeamMember } = await import(
  "@/app/dashboard/projects/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// orgA: a project + a company (link target). orgB: its own project + company +
// a seeded team member (foreign targets).
const projectAId = randomUUID();
const companyAId = randomUUID();
const projectBId = randomUUID();
const companyBId = randomUUID();
const memberBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.project.create({
      data: { id: projectAId, orgId: orgA.id, name: "Riverfront A", stage: "concept" },
    });
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Architects",
        status: "prospect",
        industry: "Architecture",
        annualValue: 0,
      },
    });
  });

  await withOrg(orgB.id, async (tx) => {
    await tx.project.create({
      data: { id: projectBId, orgId: orgB.id, name: "Riverfront B", stage: "concept" },
    });
    await tx.company.create({
      data: {
        id: companyBId,
        orgId: orgB.id,
        name: "Foreign Firm",
        status: "prospect",
        industry: "Architecture",
        annualValue: 0,
      },
    });
    await tx.projectTeamMember.create({
      data: {
        id: memberBId,
        orgId: orgB.id,
        projectId: projectBId,
        role: "architect",
        name: "Foreign Member",
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

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addTeamMember", () => {
  test("stores the roster fields with an optional company link", async () => {
    await addTeamMember(
      fd({
        projectId: projectAId,
        role: "land_use_attorney",
        name: "Jane Counsel",
        org: "Counsel LLP",
        email: "jane@counsel.com",
        companyId: companyAId,
      }),
    );

    const member = await withOrg(orgA.id, (tx) =>
      tx.projectTeamMember.findFirst({
        where: { projectId: projectAId, name: "Jane Counsel" },
      }),
    );
    expect(member).not.toBeNull();
    expect(member!.role).toBe("land_use_attorney");
    expect(member!.org).toBe("Counsel LLP");
    expect(member!.email).toBe("jane@counsel.com");
    expect(member!.companyId).toBe(companyAId);
  });

  test("rejects an out-of-vocabulary role", async () => {
    await expect(
      addTeamMember(fd({ projectId: projectAId, role: "wizard", name: "X" })),
    ).rejects.toThrow("invalid team role");
  });

  test("requires a name or organization", async () => {
    await expect(
      addTeamMember(fd({ projectId: projectAId, role: "architect" })),
    ).rejects.toThrow("a name or organization is required");
  });

  test("refuses a foreign project id", async () => {
    await expect(
      addTeamMember(fd({ projectId: projectBId, role: "architect", name: "Sneak" })),
    ).rejects.toThrow("project not found in this organization");
  });

  test("refuses a foreign company link", async () => {
    await expect(
      addTeamMember(
        fd({
          projectId: projectAId,
          role: "architect",
          name: "Linker",
          companyId: companyBId,
        }),
      ),
    ).rejects.toThrow("linked company not found in this organization");
  });
});

describe("updateTeamMember", () => {
  test("refuses a foreign member id and leaves it untouched", async () => {
    await expect(
      updateTeamMember(
        fd({
          memberId: memberBId,
          projectId: projectBId,
          role: "lender",
          name: "Hijacked",
        }),
      ),
    ).rejects.toThrow("team member not found in this organization");

    const untouched = await withOrg(orgB.id, (tx) =>
      tx.projectTeamMember.findUnique({ where: { id: memberBId } }),
    );
    expect(untouched!.name).toBe("Foreign Member");
    expect(untouched!.role).toBe("architect");
  });
});

describe("removeTeamMember", () => {
  test("refuses to delete a foreign member (no-op)", async () => {
    await removeTeamMember(fd({ memberId: memberBId, projectId: projectBId }));

    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.projectTeamMember.findUnique({ where: { id: memberBId } }),
    );
    expect(stillThere).not.toBeNull();
  });
});
