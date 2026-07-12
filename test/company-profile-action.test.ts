import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P1 editable-profile slice
// (updateCompany + changeCompanyStatus). Runs against the real Neon DB, mocking
// only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// whitelisted field write, that a status transition is journaled as a
// status_changed Activity (with a from/to payload, so the relationship timeline
// reflects the lifecycle), that a no-op status change writes nothing, that
// unknown network tags and duplicate counties are sanitized, and — the cardinal
// rule — that a foreign company id is refused by RLS and leaves the other tenant
// untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { updateCompany, changeCompanyStatus } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

const companyAId = randomUUID();
const statusCompanyId = randomUUID();
const companyBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: staffUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "staff" },
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "prospect",
        industry: "Manufacturing",
        annualValue: 1000,
        notes: "Existing note.",
      },
    });
    await tx.company.create({
      data: {
        id: statusCompanyId,
        orgId: orgA.id,
        name: "Lifecycle Co",
        status: "prospect",
        industry: "Retail",
        annualValue: 1000,
      },
    });
  });

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
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item);
    else f.set(k, v);
  }
  return f;
}

describe("updateCompany", () => {
  test("writes the whitelisted fields, sanitizes counties + network tags, and logs the status change", async () => {
    await updateCompany(
      fd({
        companyId: companyAId,
        status: "member",
        industry: "Advanced Manufacturing",
        annualValue: "25000",
        tier: "Director",
        temperature: "80",
        website: "https://acme.test",
        emailDomain: "acme.test",
        source: "referral",
        memberSince: "2024",
        dealSize: "$1-5M",
        lookingFor: "growth capital",
        canOffer: "manufacturing capacity",
        agencyContacts: "Jane at the IDA",
        notes: "Fresh notes.",
        counties: "Ulster, Dutchess, Ulster, ",
        networkTags: ["seeking_equity", "not_a_real_tag", "ida_active"],
      }),
    );

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          status: true,
          industry: true,
          annualValue: true,
          tier: true,
          temperature: true,
          website: true,
          emailDomain: true,
          source: true,
          memberSince: true,
          dealSize: true,
          lookingFor: true,
          canOffer: true,
          agencyContacts: true,
          notes: true,
          counties: true,
          networkTags: true,
        },
      }),
    );
    expect(company!.status).toBe("member");
    expect(company!.industry).toBe("Advanced Manufacturing");
    expect(Number(company!.annualValue)).toBe(25000);
    expect(company!.tier).toBe("Director");
    expect(company!.temperature).toBe(80);
    expect(company!.website).toBe("https://acme.test");
    expect(company!.emailDomain).toBe("acme.test");
    expect(company!.source).toBe("referral");
    expect(company!.memberSince).toBe(2024);
    expect(company!.dealSize).toBe("$1-5M");
    expect(company!.lookingFor).toBe("growth capital");
    expect(company!.canOffer).toBe("manufacturing capacity");
    expect(company!.agencyContacts).toBe("Jane at the IDA");
    expect(company!.notes).toBe("Fresh notes.");
    // Counties: trimmed + de-duped (order preserved), blank dropped.
    expect(company!.counties).toEqual(["Ulster", "Dutchess"]);
    // Only known org-tag keys survive.
    expect(company!.networkTags).toEqual(["seeking_equity", "ida_active"]);

    // The prospect → member transition was journaled.
    const activities = await withOrg(orgA.id, (tx) =>
      tx.activity.findMany({
        where: { companyId: companyAId, type: "status_changed" },
        select: { payload: true, actorUserId: true },
      }),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].payload).toMatchObject({ from: "prospect", to: "member" });
    expect(activities[0].actorUserId).toBe(staffUser.id);
  });

  test("does not log an Activity when the status is unchanged", async () => {
    // companyA is already 'member' from the prior test; re-save with same status.
    await updateCompany(
      fd({
        companyId: companyAId,
        status: "member",
        industry: "Advanced Manufacturing",
        annualValue: "25000",
        notes: "Fresh notes.",
      }),
    );
    const count = await withOrg(orgA.id, (tx) =>
      tx.activity.count({
        where: { companyId: companyAId, type: "status_changed" },
      }),
    );
    expect(count).toBe(1);
  });

  test("rejects an unknown status", async () => {
    await expect(
      updateCompany(
        fd({ companyId: companyAId, status: "vip", industry: "X" }),
      ),
    ).rejects.toThrow("invalid company status");
  });

  test("requires an industry", async () => {
    await expect(
      updateCompany(
        fd({ companyId: companyAId, status: "member", industry: "  " }),
      ),
    ).rejects.toThrow("industry is required");
  });

  test("refuses a company id from another tenant and leaves it untouched", async () => {
    await expect(
      updateCompany(
        fd({
          companyId: companyBId,
          status: "former",
          industry: "Hijacked",
        }),
      ),
    ).rejects.toThrow("company not found in this organization");

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyBId },
        select: { status: true, industry: true },
      }),
    );
    expect(companyB!.status).toBe("member");
    expect(companyB!.industry).toBe("Legal");
  });
});

describe("changeCompanyStatus", () => {
  test("transitions the status and journals the change", async () => {
    await changeCompanyStatus(
      fd({ companyId: statusCompanyId, status: "member" }),
    );

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: statusCompanyId },
        select: { status: true },
      }),
    );
    expect(company!.status).toBe("member");

    const activities = await withOrg(orgA.id, (tx) =>
      tx.activity.findMany({
        where: { companyId: statusCompanyId, type: "status_changed" },
        select: { payload: true },
      }),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].payload).toMatchObject({ from: "prospect", to: "member" });
  });

  test("is idempotent — a no-op transition writes no Activity", async () => {
    await changeCompanyStatus(
      fd({ companyId: statusCompanyId, status: "member" }),
    );
    const count = await withOrg(orgA.id, (tx) =>
      tx.activity.count({
        where: { companyId: statusCompanyId, type: "status_changed" },
      }),
    );
    expect(count).toBe(1);
  });

  test("rejects an unknown status", async () => {
    await expect(
      changeCompanyStatus(fd({ companyId: statusCompanyId, status: "vip" })),
    ).rejects.toThrow("invalid company status");
  });

  test("refuses a company id from another tenant and leaves it untouched", async () => {
    await expect(
      changeCompanyStatus(fd({ companyId: companyBId, status: "former" })),
    ).rejects.toThrow("company not found in this organization");

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyBId },
        select: { status: true },
      }),
    );
    expect(companyB!.status).toBe("member");
  });
});
