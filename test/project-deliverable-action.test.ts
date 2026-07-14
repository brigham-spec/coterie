import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the project-deliverables slice
// (addProjectDeliverable + updateProjectDeliverable + deleteProjectDeliverable).
// Runs against the real Neon DB, mocking only Clerk (requireOrgContext) and Next's
// revalidatePath. A deliverable is an action_item on a project; its owner carries
// direction — a staff member ("we owe") or a contact at a company on the project
// ("they owe"). Proves both owner paths persist under the owner-XOR CHECK, and —
// the cardinal rule — that a foreign project id, a non-member staff owner, and an
// off-project contact owner are all refused, and that update/delete are RLS-scoped
// so a foreign deliverable id is a no-op.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const {
  addProjectDeliverable,
  updateProjectDeliverable,
  deleteProjectDeliverable,
} = await import("@/app/dashboard/projects/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// Staff owner (member of orgA) + an outsider (member of orgB only → invalid target).
const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};
const outsiderUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `outsider_${randomUUID()}@example.com`,
  name: "Outsider",
};

const projectAId = randomUUID();
const projectBId = randomUUID();
const companyAId = randomUUID(); // linked to project A
const companyUnlinkedId = randomUUID(); // exists in org A, NOT on project A
const companyBId = randomUUID();
const contactAId = randomUUID(); // at company A → valid "they owe" owner
const contactUnlinkedId = randomUUID(); // at unlinked company → off-project owner
const contactBId = randomUUID(); // org B contact (foreign)
// A seeded orgB deliverable — the foreign target for update/delete refusal tests.
const deliverableBId = randomUUID();

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
    await tx.project.create({
      data: { id: projectAId, orgId: orgA.id, name: "Riverfront", stage: "concept" },
    });
    await tx.company.createMany({
      data: [
        { id: companyAId, orgId: orgA.id, name: "Acme Dev", status: "member", industry: "Real Estate", annualValue: 1000 },
        { id: companyUnlinkedId, orgId: orgA.id, name: "Off Project Co", status: "prospect", industry: "Retail", annualValue: 1000 },
      ],
    });
    await tx.projectLink.create({
      data: { orgId: orgA.id, projectId: projectAId, companyId: companyAId, role: "developer" },
    });
    await tx.contact.createMany({
      data: [
        { id: contactAId, orgId: orgA.id, companyId: companyAId, name: "Dana Owner" },
        { id: contactUnlinkedId, orgId: orgA.id, companyId: companyUnlinkedId, name: "Elsewhere Contact" },
      ],
    });
  });

  await withOrg(orgB.id, async (tx) => {
    await tx.project.create({
      data: { id: projectBId, orgId: orgB.id, name: "Beta Tower", stage: "concept" },
    });
    await tx.company.create({
      data: { id: companyBId, orgId: orgB.id, name: "Beta Corp", status: "member", industry: "Legal", annualValue: 1000 },
    });
    await tx.contact.create({
      data: { id: contactBId, orgId: orgB.id, companyId: companyBId, name: "Beta Person" },
    });
    await tx.actionItem.create({
      data: {
        id: deliverableBId,
        orgId: orgB.id,
        projectId: projectBId,
        text: "Beta deliverable",
        ownerContactId: contactBId,
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
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

describe("addProjectDeliverable", () => {
  test("creates a 'we owe' deliverable owned by a staff member", async () => {
    await addProjectDeliverable(
      fd({
        projectId: projectAId,
        text: "Send the IDA application draft",
        direction: "we_owe",
        ownerId: staffUser.id,
      }),
    );

    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { projectId: projectAId, text: "Send the IDA application draft" },
        select: { ownerUserId: true, ownerContactId: true, status: true },
      }),
    );
    expect(item!.ownerUserId).toBe(staffUser.id);
    expect(item!.ownerContactId).toBeNull();
    expect(item!.status).toBe("open");
  });

  test("creates a 'they owe' deliverable owned by an on-project contact", async () => {
    await addProjectDeliverable(
      fd({
        projectId: projectAId,
        text: "Return the signed LOI",
        direction: "they_owe",
        ownerId: contactAId,
      }),
    );

    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { projectId: projectAId, text: "Return the signed LOI" },
        select: { ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(item!.ownerContactId).toBe(contactAId);
    expect(item!.ownerUserId).toBeNull();
  });

  test("refuses a staff owner who is not a member of this org", async () => {
    await expect(
      addProjectDeliverable(
        fd({ projectId: projectAId, text: "Hijack", direction: "we_owe", ownerId: outsiderUser.id }),
      ),
    ).rejects.toThrow("owner is not a member of this organization");
  });

  test("refuses a contact owner not on the project", async () => {
    await expect(
      addProjectDeliverable(
        fd({ projectId: projectAId, text: "Hijack", direction: "they_owe", ownerId: contactUnlinkedId }),
      ),
    ).rejects.toThrow("owner must be a contact on a company linked to this project");
  });

  test("refuses a project id from another tenant", async () => {
    await expect(
      addProjectDeliverable(
        fd({ projectId: projectBId, text: "Hijack", direction: "we_owe", ownerId: staffUser.id }),
      ),
    ).rejects.toThrow("project not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.actionItem.count({ where: { projectId: projectBId } }),
    );
    // Only the seeded Beta deliverable remains — no foreign write landed.
    expect(count).toBe(1);
  });
});

describe("updateProjectDeliverable", () => {
  test("advances a deliverable's status", async () => {
    const created = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirstOrThrow({
        where: { projectId: projectAId, text: "Send the IDA application draft" },
        select: { id: true },
      }),
    );
    await updateProjectDeliverable(
      fd({ id: created.id, projectId: projectAId, status: "done" }),
    );
    const after = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: created.id }, select: { status: true } }),
    );
    expect(after!.status).toBe("done");
  });

  test("refuses to touch a deliverable from another tenant", async () => {
    await updateProjectDeliverable(
      fd({ id: deliverableBId, projectId: projectBId, status: "done" }),
    );
    const beta = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: deliverableBId }, select: { status: true } }),
    );
    // RLS scoped the update to org A, so the org B row is untouched.
    expect(beta!.status).toBe("open");
  });
});

describe("deleteProjectDeliverable", () => {
  test("deletes a deliverable scoped to the tenant", async () => {
    const created = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirstOrThrow({
        where: { projectId: projectAId, text: "Return the signed LOI" },
        select: { id: true },
      }),
    );
    await deleteProjectDeliverable(fd({ id: created.id, projectId: projectAId }));
    const gone = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: created.id } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses to delete a deliverable from another tenant", async () => {
    await deleteProjectDeliverable(fd({ id: deliverableBId, projectId: projectBId }));
    const beta = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: deliverableBId } }),
    );
    expect(beta).not.toBeNull();
  });
});
