import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P3 membership-proposals slice
// (createProposal + updateProposalStatus + deleteProposal). Runs against the
// real Neon DB, mocking only Clerk (requireOrgContext) and Next's
// revalidatePath. Proves the field write with status validation, that moving a
// proposal to "won" nudges a prospect company to member and journals the change,
// that a status update stamps lastFollowUpAt, and — the cardinal rule — that a
// foreign company id (create) or proposal id (update/delete) is refused by RLS.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { createProposal, updateProposalStatus, deleteProposal } = await import(
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

// company A hosts the create/update flow; wonCompany starts as a prospect to
// prove the win-nudge; company B is the foreign tenant.
const companyAId = randomUUID();
const wonCompanyId = randomUUID();
// An existing member (not a prospect) — winning a proposal against it must not
// overwrite its tier/value.
const memberCompanyId = randomUUID();
const companyBId = randomUUID();
const proposalBId = randomUUID();

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
      },
    });
    await tx.company.create({
      data: {
        id: wonCompanyId,
        orgId: orgA.id,
        name: "Convert Co",
        status: "prospect",
        industry: "Retail",
        annualValue: 1000,
      },
    });
    await tx.company.create({
      data: {
        id: memberCompanyId,
        orgId: orgA.id,
        name: "Founders Co",
        status: "member",
        tier: "Founders Tier",
        industry: "Energy",
        annualValue: 30000,
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
    await tx.membershipProposal.create({
      data: {
        id: proposalBId,
        orgId: orgB.id,
        companyId: companyBId,
        tier: "Director",
        status: "sent",
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

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createProposal", () => {
  test("logs a proposal under its company with the given fields", async () => {
    await createProposal(
      fd({
        companyId: companyAId,
        tier: "Director",
        amount: "25000",
        status: "sent",
        sentOn: "2026-06-01",
        driveUrl: "https://drive.test/proposal",
        notes: "First offer.",
      }),
    );

    const proposal = await withOrg(orgA.id, (tx) =>
      tx.membershipProposal.findFirst({
        where: { companyId: companyAId },
        select: {
          tier: true,
          amount: true,
          status: true,
          sentOn: true,
          driveUrl: true,
          notes: true,
        },
      }),
    );
    expect(proposal!.tier).toBe("Director");
    expect(Number(proposal!.amount)).toBe(25000);
    expect(proposal!.status).toBe("sent");
    expect(proposal!.sentOn?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(proposal!.driveUrl).toBe("https://drive.test/proposal");
    expect(proposal!.notes).toBe("First offer.");
  });

  test("rejects an unknown status", async () => {
    await expect(
      createProposal(fd({ companyId: companyAId, tier: "X", status: "accepted" })),
    ).rejects.toThrow("invalid proposal status");
  });

  test("requires a tier", async () => {
    await expect(
      createProposal(fd({ companyId: companyAId, tier: "  " })),
    ).rejects.toThrow("tier is required");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      createProposal(fd({ companyId: companyBId, tier: "Director" })),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.membershipProposal.count({ where: { companyId: companyBId } }),
    );
    // Only the seeded Beta proposal remains — no foreign write landed.
    expect(count).toBe(1);
  });
});

describe("updateProposalStatus", () => {
  test("moves a proposal to won, converts the prospect, and journals the change", async () => {
    const proposalId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.membershipProposal.create({
        data: {
          id: proposalId,
          orgId: orgA.id,
          companyId: wonCompanyId,
          tier: "Director",
          status: "negotiating",
        },
      }),
    );

    await updateProposalStatus(fd({ proposalId, status: "won" }));

    const result = await withOrg(orgA.id, async (tx) => {
      const proposal = await tx.membershipProposal.findUnique({
        where: { id: proposalId },
        select: { status: true, lastFollowUpAt: true },
      });
      const company = await tx.company.findUnique({
        where: { id: wonCompanyId },
        select: { status: true, tier: true, annualValue: true },
      });
      const activities = await tx.activity.findMany({
        where: { companyId: wonCompanyId, type: "status_changed" },
        select: { payload: true, actorUserId: true },
      });
      return { proposal, company, activities };
    });

    expect(result.proposal!.status).toBe("won");
    // Touching the proposal stamps the follow-up clock so the nudge treats it fresh.
    expect(result.proposal!.lastFollowUpAt).not.toBeNull();
    // The prospect was nudged into membership and the transition journaled.
    expect(result.company!.status).toBe("member");
    // The proposal's tier is stamped onto the new member…
    expect(result.company!.tier).toBe("Director");
    // …but its annualValue is left untouched because this proposal named no amount.
    expect(Number(result.company!.annualValue)).toBe(1000);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].payload).toMatchObject({
      from: "prospect",
      to: "member",
    });
    expect(result.activities[0].actorUserId).toBe(staffUser.id);
  });

  test("stamps the proposed tier and amount onto the promoted member", async () => {
    const amountCompanyId = randomUUID();
    const proposalId = randomUUID();
    await withOrg(orgA.id, async (tx) => {
      await tx.company.create({
        data: {
          id: amountCompanyId,
          orgId: orgA.id,
          name: "Amount Co",
          status: "prospect",
          industry: "Finance",
          annualValue: 1000,
        },
      });
      await tx.membershipProposal.create({
        data: {
          id: proposalId,
          orgId: orgA.id,
          companyId: amountCompanyId,
          tier: "Chairman's Circle",
          amount: "50000",
          status: "negotiating",
        },
      });
    });

    await updateProposalStatus(fd({ proposalId, status: "won" }));

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: amountCompanyId },
        select: { status: true, tier: true, annualValue: true },
      }),
    );
    expect(company!.status).toBe("member");
    expect(company!.tier).toBe("Chairman's Circle");
    // The proposal named $50k, so the new member's annual value inherits it.
    expect(Number(company!.annualValue)).toBe(50000);
  });

  test("leaves a non-prospect company's tier and value untouched on win", async () => {
    const proposalId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.membershipProposal.create({
        data: {
          id: proposalId,
          orgId: orgA.id,
          companyId: memberCompanyId,
          tier: "Advisory",
          amount: "9000",
          status: "sent",
        },
      }),
    );

    await updateProposalStatus(fd({ proposalId, status: "won" }));

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: memberCompanyId },
        select: { status: true, tier: true, annualValue: true },
      }),
    );
    // Already a member — the win records the proposal but does not overwrite
    // the existing tier/value (only prospect promotions apply the proposal).
    expect(company!.status).toBe("member");
    expect(company!.tier).toBe("Founders Tier");
    expect(Number(company!.annualValue)).toBe(30000);
  });

  test("rejects an unknown status", async () => {
    await expect(
      updateProposalStatus(fd({ proposalId: randomUUID(), status: "accepted" })),
    ).rejects.toThrow("invalid proposal status");
  });

  test("refuses a proposal id from another tenant and leaves it untouched", async () => {
    await expect(
      updateProposalStatus(fd({ proposalId: proposalBId, status: "won" })),
    ).rejects.toThrow("proposal not found in this organization");

    const proposalB = await withOrg(orgB.id, (tx) =>
      tx.membershipProposal.findUnique({
        where: { id: proposalBId },
        select: { status: true },
      }),
    );
    expect(proposalB!.status).toBe("sent");
  });
});

describe("deleteProposal", () => {
  test("deletes a proposal scoped to the tenant", async () => {
    const proposalId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.membershipProposal.create({
        data: {
          id: proposalId,
          orgId: orgA.id,
          companyId: companyAId,
          tier: "Advisory",
          status: "draft",
        },
      }),
    );

    await deleteProposal(fd({ proposalId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.membershipProposal.findUnique({ where: { id: proposalId } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses a proposal id from another tenant and leaves it untouched", async () => {
    await expect(
      deleteProposal(fd({ proposalId: proposalBId })),
    ).rejects.toThrow("proposal not found in this organization");

    const proposalB = await withOrg(orgB.id, (tx) =>
      tx.membershipProposal.findUnique({ where: { id: proposalBId } }),
    );
    expect(proposalB).not.toBeNull();
  });
});
