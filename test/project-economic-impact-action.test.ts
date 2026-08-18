import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { parseImpactForm } from "@/lib/value-created";
import { parseHvServices, sumActiveServiceFees } from "@/lib/hv-services";

// Action-level integration test for the S3 economic-impact / service-fee / profile
// slice: the developer link on createProject, updateProjectDetails, the
// economic_impact writes (scalars + grants), and the hv_services write. Runs
// against the real Neon DB, mocking only Clerk and Next's revalidatePath.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const {
  createProject,
  updateProjectDetails,
  updateEconomicImpact,
  addProjectGrant,
  removeProjectGrant,
  updateHvServices,
} = await import("@/app/dashboard/projects/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };
let devCompanyId = "";
let foreignCompanyId = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { ...orgA, orgType: "edc" } });
  await prisma.organization.create({ data: { ...orgB, orgType: "edc" } });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;

  devCompanyId = await withOrg(orgA.id, async (tx) => {
    const c = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: `Developer ${randomUUID()}`,
        status: "prospect",
        industry: "Real Estate",
        annualValue: "0",
      },
    });
    return c.id;
  });
  foreignCompanyId = await withOrg(orgB.id, async (tx) => {
    const c = await tx.company.create({
      data: {
        orgId: orgB.id,
        name: `Foreign ${randomUUID()}`,
        status: "prospect",
        industry: "Real Estate",
        annualValue: "0",
      },
    });
    return c.id;
  });
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

async function makeProject(): Promise<{ id: string; name: string }> {
  const name = `Impact ${randomUUID()}`;
  await createProject(fd({ name, stage: "concept" }));
  const p = await withOrg(orgA.id, (tx) =>
    tx.project.findFirst({ where: { name }, select: { id: true } }),
  );
  return { id: p!.id, name };
}

describe("createProject developer link", () => {
  test("resolves an in-tenant company to developerMemberId", async () => {
    const name = `Linked ${randomUUID()}`;
    await createProject(
      fd({ name, stage: "concept", industry: "Hospitality", developerMemberId: devCompanyId }),
    );
    const created = await withOrg(orgA.id, (tx) =>
      tx.project.findFirst({
        where: { name },
        select: { industry: true, developerMemberId: true },
      }),
    );
    expect(created!.industry).toBe("Hospitality");
    expect(created!.developerMemberId).toBe(devCompanyId);
  });

  test("refuses a developer company from another tenant", async () => {
    await expect(
      createProject(
        fd({ name: `Foreign ${randomUUID()}`, stage: "concept", developerMemberId: foreignCompanyId }),
      ),
    ).rejects.toThrow("linked company not found in this organization");
  });
});

describe("updateProjectDetails", () => {
  test("edits every core detail field and the developer link", async () => {
    const { id, name } = await makeProject();
    await updateProjectDetails(
      fd({
        projectId: id,
        name: `${name} (renamed)`,
        description: "Reworked scope",
        type: "Mixed-use",
        industry: "Manufacturing",
        county: "Dutchess",
        units: "120",
        sqft: "45000",
        value: "9000000",
        realizedValue: "3000000",
        targetDate: "2027-06-01",
        prospectLead: "Off-network Dev LLC",
        developerMemberId: devCompanyId,
      }),
    );
    const updated = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({
        where: { id },
        select: {
          name: true,
          description: true,
          type: true,
          industry: true,
          county: true,
          units: true,
          sqft: true,
          value: true,
          realizedValue: true,
          targetDate: true,
          prospectLead: true,
          developerMemberId: true,
        },
      }),
    );
    expect(updated!.name).toBe(`${name} (renamed)`);
    expect(updated!.description).toBe("Reworked scope");
    expect(updated!.type).toBe("Mixed-use");
    expect(updated!.industry).toBe("Manufacturing");
    expect(updated!.county).toBe("Dutchess");
    expect(updated!.units).toBe(120);
    expect(updated!.sqft).toBe(45000);
    expect(Number(updated!.value)).toBe(9_000_000);
    expect(Number(updated!.realizedValue)).toBe(3_000_000);
    expect(updated!.targetDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(updated!.prospectLead).toBe("Off-network Dev LLC");
    expect(updated!.developerMemberId).toBe(devCompanyId);
  });

  test("clears optional fields and the developer link when blank", async () => {
    const { id, name } = await makeProject();
    await updateProjectDetails(
      fd({ projectId: id, name, industry: "Retail", developerMemberId: devCompanyId }),
    );
    await updateProjectDetails(fd({ projectId: id, name }));
    const updated = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({
        where: { id },
        select: { industry: true, value: true, developerMemberId: true },
      }),
    );
    expect(updated!.industry).toBeNull();
    expect(updated!.value).toBeNull();
    expect(updated!.developerMemberId).toBeNull();
  });

  test("rejects a blank name", async () => {
    const { id } = await makeProject();
    await expect(
      updateProjectDetails(fd({ projectId: id, name: "" })),
    ).rejects.toThrow("name is required");
  });
});

describe("updateEconomicImpact", () => {
  test("writes scalar fields and the tax abatement, preserving grants", async () => {
    const { id } = await makeProject();
    await addProjectGrant(fd({ projectId: id, name: "CFA", amount: "100000", status: "Awarded" }));
    await updateEconomicImpact(
      fd({
        projectId: id,
        permanentJobs: "40",
        constructionJobs: "25",
        constructionCost: "1000000",
        taxAbatementActive: "on",
        taxAbatementValue: "500000",
      }),
    );
    const updated = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id }, select: { economicImpact: true } }),
    );
    const form = parseImpactForm(updated!.economicImpact);
    expect(form.permanentJobs).toBe(40);
    expect(form.constructionJobs).toBe(25);
    expect(form.constructionCost).toBe(1_000_000);
    expect(form.taxAbatementActive).toBe(true);
    expect(form.taxAbatementValue).toBe(500_000);
    expect(form.grants).toHaveLength(1);
    expect(form.grants[0].name).toBe("CFA");
  });
});

describe("addProjectGrant / removeProjectGrant", () => {
  test("appends a grant with a stable id and removes it by id", async () => {
    const { id } = await makeProject();
    await addProjectGrant(fd({ projectId: id, name: "Grant A", amount: "50000", status: "Applied" }));
    await addProjectGrant(fd({ projectId: id, name: "Grant B", amount: "75000", status: "Received" }));

    const afterAdd = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id }, select: { economicImpact: true } }),
    );
    const grants = parseImpactForm(afterAdd!.economicImpact).grants;
    expect(grants.map((g) => g.name)).toEqual(["Grant A", "Grant B"]);
    expect(grants[0].id).not.toBe("");

    await removeProjectGrant(fd({ projectId: id, grantId: grants[0].id }));
    const afterRemove = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id }, select: { economicImpact: true } }),
    );
    const remaining = parseImpactForm(afterRemove!.economicImpact).grants;
    expect(remaining.map((g) => g.name)).toEqual(["Grant B"]);
  });
});

describe("updateHvServices", () => {
  test("writes the five service lines and sums active fees", async () => {
    const { id } = await makeProject();
    await updateHvServices(
      fd({
        projectId: id,
        capitalSourcing_active: "on",
        capitalSourcing_status: "Active",
        capitalSourcing_description: "Sourcing a construction loan",
        capitalSourcing_fee: "25000",
        capitalSourcing_feeStatus: "Invoiced",
        idaNavigation_active: "on",
        idaNavigation_fee: "10000",
        realEstateSales_fee: "9999",
      }),
    );
    const updated = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id }, select: { hvServices: true } }),
    );
    const services = parseHvServices(updated!.hvServices);
    const capital = services.find((s) => s.key === "capitalSourcing")!;
    expect(capital.line.active).toBe(true);
    expect(capital.line.status).toBe("Active");
    expect(capital.line.fee).toBe(25_000);
    expect(capital.line.feeStatus).toBe("Invoiced");
    // realEstateSales carries a fee but is inactive, so it is excluded from the sum.
    expect(sumActiveServiceFees(services)).toBe(35_000);
  });

  test("drops an out-of-vocab status at the write boundary", async () => {
    const { id } = await makeProject();
    await updateHvServices(
      fd({
        projectId: id,
        capitalSourcing_active: "on",
        capitalSourcing_status: "bogus",
        capitalSourcing_feeStatus: "nonsense",
      }),
    );
    const updated = await withOrg(orgA.id, (tx) =>
      tx.project.findUnique({ where: { id }, select: { hvServices: true } }),
    );
    const capital = parseHvServices(updated!.hvServices).find((s) => s.key === "capitalSourcing")!;
    expect(capital.line.status).toBe("");
    expect(capital.line.feeStatus).toBe("");
  });
});
