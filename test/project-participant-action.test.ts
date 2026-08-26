import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the unified Participant roster slice
// (add/update/removeParticipant on project_links). Runs against the real Neon DB,
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves: a
// company participant with a primary contact; an off-network row (null company +
// free-text); multiple roles for one company; the contact-must-belong-to-company
// guard; update; remove by row id; and that a foreign project / link / company id
// is refused by RLS with the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { addParticipant, updateParticipant, removeParticipant } = await import(
  "@/app/dashboard/projects/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// orgA: a project, two companies (one with a contact each). orgB: its own
// project + company + a seeded participant (foreign targets).
const projectAId = randomUUID();
const companyAId = randomUUID();
const contactAId = randomUUID();
const otherCompanyAId = randomUUID();
const otherContactAId = randomUUID();
const projectBId = randomUUID();
const companyBId = randomUUID();
const linkBId = randomUUID();

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
    await tx.contact.create({
      data: { id: contactAId, orgId: orgA.id, companyId: companyAId, name: "Jane Counsel" },
    });
    await tx.company.create({
      data: {
        id: otherCompanyAId,
        orgId: orgA.id,
        name: "Beta Builders",
        status: "prospect",
        industry: "Construction",
        annualValue: 0,
      },
    });
    await tx.contact.create({
      data: {
        id: otherContactAId,
        orgId: orgA.id,
        companyId: otherCompanyAId,
        name: "Bob Beta",
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
    await tx.projectLink.create({
      data: {
        id: linkBId,
        orgId: orgB.id,
        projectId: projectBId,
        companyId: companyBId,
        role: "developer",
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

describe("addParticipant", () => {
  test("links a company with a primary contact", async () => {
    await addParticipant(
      fd({
        projectId: projectAId,
        role: "developer",
        companyId: companyAId,
        contactId: contactAId,
      }),
    );

    const link = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findFirst({
        where: { projectId: projectAId, companyId: companyAId, role: "developer" },
      }),
    );
    expect(link).not.toBeNull();
    expect(link!.contactId).toBe(contactAId);
    // Company rows keep the free-text fallbacks empty.
    expect(link!.name).toBe("");
    expect(link!.org).toBe("");
  });

  test("allows a second role for the same company", async () => {
    await addParticipant(
      fd({ projectId: projectAId, role: "lender", companyId: companyAId }),
    );

    const links = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findMany({
        where: { projectId: projectAId, companyId: companyAId },
      }),
    );
    expect(links.map((l) => l.role).sort()).toEqual(["developer", "lender"]);
  });

  test("stores an off-network participant with free text and no company", async () => {
    await addParticipant(
      fd({
        projectId: projectAId,
        role: "architect",
        name: "Off Grid",
        org: "Solo Studio",
        email: "off@grid.com",
      }),
    );

    const link = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findFirst({ where: { projectId: projectAId, name: "Off Grid" } }),
    );
    expect(link).not.toBeNull();
    expect(link!.companyId).toBeNull();
    expect(link!.contactId).toBeNull();
    expect(link!.org).toBe("Solo Studio");
    expect(link!.email).toBe("off@grid.com");
  });

  test("rejects a contact that is not at the selected company", async () => {
    await expect(
      addParticipant(
        fd({
          projectId: projectAId,
          role: "advisor",
          companyId: companyAId,
          contactId: otherContactAId,
        }),
      ),
    ).rejects.toThrow("primary contact must be a contact at the selected company");
  });

  test("rejects an out-of-vocabulary role", async () => {
    await expect(
      addParticipant(fd({ projectId: projectAId, role: "wizard", companyId: companyAId })),
    ).rejects.toThrow("invalid role");
  });

  test("requires a company, name, or organization for an off-network row", async () => {
    await expect(
      addParticipant(fd({ projectId: projectAId, role: "architect" })),
    ).rejects.toThrow("select a company, or enter a name or organization");
  });

  test("refuses a foreign project id", async () => {
    await expect(
      addParticipant(fd({ projectId: projectBId, role: "developer", companyId: companyAId })),
    ).rejects.toThrow("project not found in this organization");
  });

  test("refuses a foreign company link", async () => {
    await expect(
      addParticipant(fd({ projectId: projectAId, role: "developer", companyId: companyBId })),
    ).rejects.toThrow("linked company not found in this organization");
  });
});

describe("updateParticipant", () => {
  test("changes a participant's role", async () => {
    const existing = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findFirst({
        where: { projectId: projectAId, companyId: companyAId, role: "lender" },
      }),
    );
    await updateParticipant(
      fd({
        linkId: existing!.id,
        projectId: projectAId,
        role: "advisor",
        companyId: companyAId,
      }),
    );

    const updated = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findUnique({ where: { id: existing!.id } }),
    );
    expect(updated!.role).toBe("advisor");
  });

  test("refuses a foreign link id and leaves it untouched", async () => {
    await expect(
      updateParticipant(
        fd({
          linkId: linkBId,
          projectId: projectBId,
          role: "lender",
          companyId: companyBId,
        }),
      ),
    ).rejects.toThrow("participant not found in this organization");

    const untouched = await withOrg(orgB.id, (tx) =>
      tx.projectLink.findUnique({ where: { id: linkBId } }),
    );
    expect(untouched!.role).toBe("developer");
  });
});

describe("removeParticipant", () => {
  test("removes a participant by its row id", async () => {
    const target = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findFirst({ where: { projectId: projectAId, name: "Off Grid" } }),
    );
    await removeParticipant(fd({ linkId: target!.id, projectId: projectAId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.projectLink.findUnique({ where: { id: target!.id } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses to delete a foreign participant (no-op)", async () => {
    await removeParticipant(fd({ linkId: linkBId, projectId: projectBId }));

    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.projectLink.findUnique({ where: { id: linkBId } }),
    );
    expect(stillThere).not.toBeNull();
  });
});
