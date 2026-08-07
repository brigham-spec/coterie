import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the interactive commitments slice
// (addCommitment + updateCommitmentStatus + editCommitment + deleteCommitment +
// reassignCommitment).
// Runs against the real Neon DB, mocking only Clerk (requireOrgContext) and
// Next's revalidatePath. Proves the owner-XOR mapping ("we owe" -> staff
// ownerUserId, "they owe" -> a contact of this company's ownerContactId), the
// optional project link, status/edit/delete lifecycle, and that every foreign
// input (company, staff owner, contact owner, project, or a foreign item id)
// is refused or scoped out by RLS with the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const {
  addCommitment,
  updateCommitmentStatus,
  editCommitment,
  deleteCommitment,
  reassignCommitment,
  moveCommitment,
} = await import("@/app/dashboard/companies/[id]/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};
// A member of orgB only — the invalid "we owe" owner for orgA.
const outsiderUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `outsider_${randomUUID()}@example.com`,
  name: "Outsider",
};

const companyAId = randomUUID();
const contactAId = randomUUID();
const projectAId = randomUUID();
// A second orgA company — the in-tenant destination for a "move" reassign.
const companyA2Id = randomUUID();

const companyBId = randomUUID();
const contactBId = randomUUID();
const projectBId = randomUUID();
// A seeded orgB commitment — the foreign target for status/edit/delete scoping.
const commitmentBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.createMany({ data: [staffUser, outsiderUser] });
  await prisma.orgMembership.createMany({
    data: [
      { orgId: orgA.id, userId: staffUser.id, role: "staff" },
      { orgId: orgB.id, userId: outsiderUser.id, role: "staff" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: { id: contactAId, orgId: orgA.id, companyId: companyAId, name: "Ada Acme" },
    });
    await tx.project.create({
      data: { id: projectAId, orgId: orgA.id, name: "Mill Redevelopment", stage: "concept" },
    });
    await tx.company.create({
      data: {
        id: companyA2Id,
        orgId: orgA.id,
        name: "Second Acme",
        status: "member",
        industry: "Logistics",
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
    await tx.contact.create({
      data: { id: contactBId, orgId: orgB.id, companyId: companyBId, name: "Bob Beta" },
    });
    await tx.project.create({
      data: { id: projectBId, orgId: orgB.id, name: "Beta Tower", stage: "concept" },
    });
    await tx.actionItem.create({
      data: {
        id: commitmentBId,
        orgId: orgB.id,
        companyId: companyBId,
        text: "Beta's own commitment",
        status: "open",
        ownerContactId: contactBId,
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [staffUser.id, outsiderUser.id] } } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addCommitment", () => {
  test("we-owe item is owned by a staff user and anchored to the company", async () => {
    await addCommitment(
      fd({
        companyId: companyAId,
        text: "Send the incentive summary",
        direction: "we_owe",
        ownerId: staffUser.id,
        projectId: projectAId,
        dueDate: "2026-08-01",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { companyId: companyAId, text: "Send the incentive summary" },
        select: {
          status: true,
          ownerUserId: true,
          ownerContactId: true,
          projectId: true,
          dueDate: true,
        },
      }),
    );
    expect(row).toMatchObject({
      status: "open",
      ownerUserId: staffUser.id,
      ownerContactId: null,
      projectId: projectAId,
    });
    expect(row!.dueDate).not.toBeNull();
  });

  test("they-owe item is owned by a contact of this company", async () => {
    await addCommitment(
      fd({
        companyId: companyAId,
        text: "Return signed NDA",
        direction: "they_owe",
        ownerId: contactAId,
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { companyId: companyAId, text: "Return signed NDA" },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({ ownerUserId: null, ownerContactId: contactAId });
  });

  test("requires commitment text", async () => {
    await expect(
      addCommitment(
        fd({ companyId: companyAId, text: "  ", direction: "we_owe", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("a commitment is required");
  });

  test("rejects an invalid direction", async () => {
    await expect(
      addCommitment(
        fd({ companyId: companyAId, text: "x", direction: "sideways", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("invalid direction");
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      addCommitment(
        fd({ companyId: companyBId, text: "hijack", direction: "we_owe", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.actionItem.count({ where: { companyId: companyBId } }),
    );
    // Only the seeded Beta commitment remains — no foreign write landed.
    expect(count).toBe(1);
  });

  test("refuses a we-owe owner who is not a member of this org", async () => {
    await expect(
      addCommitment(
        fd({ companyId: companyAId, text: "x", direction: "we_owe", ownerId: outsiderUser.id }),
      ),
    ).rejects.toThrow("owner is not a member of this organization");
  });

  test("refuses a they-owe owner who is not a contact of this company", async () => {
    await expect(
      addCommitment(
        fd({ companyId: companyAId, text: "x", direction: "they_owe", ownerId: contactBId }),
      ),
    ).rejects.toThrow("contact not found on this company");
  });

  test("refuses a project id from another tenant", async () => {
    await expect(
      addCommitment(
        fd({
          companyId: companyAId,
          text: "x",
          direction: "we_owe",
          ownerId: staffUser.id,
          projectId: projectBId,
        }),
      ),
    ).rejects.toThrow("project not found in this organization");
  });
});

describe("updateCommitmentStatus", () => {
  test("advances an item's status scoped to the tenant", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Draft MOU",
          status: "open",
          ownerUserId: staffUser.id,
        },
      }),
    );

    await updateCommitmentStatus(fd({ id, companyId: companyAId, status: "done" }));

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { status: true } }),
    );
    expect(row!.status).toBe("done");
  });

  test("rejects an invalid status", async () => {
    await expect(
      updateCommitmentStatus(fd({ id: randomUUID(), companyId: companyAId, status: "maybe" })),
    ).rejects.toThrow("invalid status");
  });

  test("a foreign item id matches no row and leaves the other tenant untouched", async () => {
    await updateCommitmentStatus(fd({ id: commitmentBId, companyId: companyAId, status: "done" }));

    const row = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId }, select: { status: true } }),
    );
    expect(row!.status).toBe("open");
  });
});

describe("editCommitment", () => {
  test("edits text and due date scoped to the tenant", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Old text",
          status: "open",
          ownerUserId: staffUser.id,
        },
      }),
    );

    await editCommitment(fd({ id, companyId: companyAId, text: "New text", dueDate: "2026-09-15" }));

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { text: true, dueDate: true } }),
    );
    expect(row!.text).toBe("New text");
    expect(row!.dueDate).not.toBeNull();
  });

  test("a foreign item id leaves the other tenant untouched", async () => {
    await editCommitment(fd({ id: commitmentBId, companyId: companyAId, text: "hijacked" }));

    const row = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId }, select: { text: true } }),
    );
    expect(row!.text).toBe("Beta's own commitment");
  });
});

describe("deleteCommitment", () => {
  test("deletes an item scoped to the tenant", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Disposable",
          status: "open",
          ownerUserId: staffUser.id,
        },
      }),
    );

    await deleteCommitment(fd({ id, companyId: companyAId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
  });

  test("a foreign item id leaves the other tenant untouched", async () => {
    await deleteCommitment(fd({ id: commitmentBId, companyId: companyAId }));

    const still = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId } }),
    );
    expect(still).not.toBeNull();
  });
});

describe("reassignCommitment", () => {
  // A fresh we-owe item to flip between owners without disturbing the others.
  async function seedWeOwe(): Promise<string> {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Reassignable",
          status: "open",
          ownerUserId: staffUser.id,
        },
      }),
    );
    return id;
  }

  test("flips a we-owe item to a they-owe contact of this company and back", async () => {
    const id = await seedWeOwe();

    await reassignCommitment(
      fd({ id, companyId: companyAId, direction: "they_owe", ownerId: contactAId }),
    );
    let row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({ ownerUserId: null, ownerContactId: contactAId });

    await reassignCommitment(
      fd({ id, companyId: companyAId, direction: "we_owe", ownerId: staffUser.id }),
    );
    row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({ ownerUserId: staffUser.id, ownerContactId: null });

    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("rejects an invalid direction", async () => {
    const id = await seedWeOwe();
    await expect(
      reassignCommitment(
        fd({ id, companyId: companyAId, direction: "sideways", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("invalid direction");
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("refuses a they-owe owner who is not a contact of this company", async () => {
    const id = await seedWeOwe();
    await expect(
      reassignCommitment(
        fd({ id, companyId: companyAId, direction: "they_owe", ownerId: contactBId }),
      ),
    ).rejects.toThrow("contact not found on this company");
    // Owner unchanged — the rejected reassign left the staff owner in place.
    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({ ownerUserId: staffUser.id, ownerContactId: null });
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("refuses a we-owe owner who is not a member of this org", async () => {
    const id = await seedWeOwe();
    await expect(
      reassignCommitment(
        fd({ id, companyId: companyAId, direction: "we_owe", ownerId: outsiderUser.id }),
      ),
    ).rejects.toThrow("owner is not a member of this organization");
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("a foreign item id is refused and leaves the other tenant untouched", async () => {
    await expect(
      reassignCommitment(
        fd({ id: commitmentBId, companyId: companyAId, direction: "we_owe", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("commitment not found on this company");

    const row = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id: commitmentBId },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({ ownerUserId: null, ownerContactId: contactBId });
  });
});

describe("moveCommitment", () => {
  // A fresh we-owe item on companyA to re-home without disturbing the others.
  async function seedWeOwe(): Promise<string> {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Movable",
          status: "open",
          ownerUserId: staffUser.id,
        },
      }),
    );
    return id;
  }

  test("re-homes a we-owe item to another company in the tenant, staff owner intact", async () => {
    const id = await seedWeOwe();

    await moveCommitment(fd({ id, companyId: companyAId, targetCompanyId: companyA2Id }));

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id },
        select: { companyId: true, ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(row).toMatchObject({
      companyId: companyA2Id,
      ownerUserId: staffUser.id,
      ownerContactId: null,
    });
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("refuses to move a they-owe item — it stays on its company", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: {
          id,
          orgId: orgA.id,
          companyId: companyAId,
          text: "Their obligation",
          status: "open",
          ownerContactId: contactAId,
        },
      }),
    );

    await expect(
      moveCommitment(fd({ id, companyId: companyAId, targetCompanyId: companyA2Id })),
    ).rejects.toThrow("commitment not found on this company");

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { companyId: true } }),
    );
    expect(row!.companyId).toBe(companyAId);
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("requires a destination and rejects the same company", async () => {
    const id = await seedWeOwe();
    await expect(
      moveCommitment(fd({ id, companyId: companyAId, targetCompanyId: "" })),
    ).rejects.toThrow("a destination company is required");
    await expect(
      moveCommitment(fd({ id, companyId: companyAId, targetCompanyId: companyAId })),
    ).rejects.toThrow("pick a different company");
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("refuses a destination company from another tenant", async () => {
    const id = await seedWeOwe();
    await expect(
      moveCommitment(fd({ id, companyId: companyAId, targetCompanyId: companyBId })),
    ).rejects.toThrow("destination company not found in this organization");

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { companyId: true } }),
    );
    expect(row!.companyId).toBe(companyAId);
    await withOrg(orgA.id, (tx) => tx.actionItem.delete({ where: { id } }));
  });

  test("a foreign item id is refused and leaves the other tenant untouched", async () => {
    await expect(
      moveCommitment(
        fd({ id: commitmentBId, companyId: companyAId, targetCompanyId: companyA2Id }),
      ),
    ).rejects.toThrow("commitment not found on this company");

    const row = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId }, select: { companyId: true } }),
    );
    expect(row!.companyId).toBe(companyBId);
  });
});
