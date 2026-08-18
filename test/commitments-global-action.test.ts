import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the global commitments workspace actions
// (logCommitment + editCommitment + updateCommitment on /dashboard/commitments).
// Runs against the real Neon DB, mocking only Clerk (requireOrgContext) and
// Next's revalidatePath. Proves the owner-XOR mapping ("we owe" -> staff owner
// validated against org_memberships, "they owe" -> a network contact re-loaded
// withOrg and anchored to its company), and that every foreign input (a staff
// owner or contact from another tenant, or a foreign item id) is refused or
// scoped out by RLS with the other tenant left untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { logCommitment, editCommitment, updateCommitment, batchUpdateCommitments } =
  await import("@/app/dashboard/commitments/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

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

const companyAId = randomUUID();
const contactAId = randomUUID();
const companyBId = randomUUID();
const contactBId = randomUUID();
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

describe("logCommitment", () => {
  test("we-owe item is owned by a staff user, no company anchor", async () => {
    await logCommitment(
      fd({
        text: "Circle back on the incentive term sheet",
        direction: "we_owe",
        ownerId: staffUser.id,
        dueDate: "2026-08-01",
      }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { text: "Circle back on the incentive term sheet" },
        select: { status: true, ownerUserId: true, ownerContactId: true, companyId: true, dueDate: true },
      }),
    );
    expect(row).toMatchObject({
      status: "open",
      ownerUserId: staffUser.id,
      ownerContactId: null,
      companyId: null,
    });
    expect(row!.dueDate).not.toBeNull();
  });

  test("they-owe item is owned by a contact and anchored to that contact's company", async () => {
    await logCommitment(
      fd({ text: "Send the updated site plan", direction: "they_owe", ownerId: contactAId }),
    );

    const row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { text: "Send the updated site plan" },
        select: { ownerUserId: true, ownerContactId: true, companyId: true },
      }),
    );
    expect(row).toMatchObject({
      ownerUserId: null,
      ownerContactId: contactAId,
      companyId: companyAId,
    });
  });

  test("requires text and a valid direction and an owner", async () => {
    await expect(
      logCommitment(fd({ text: "  ", direction: "we_owe", ownerId: staffUser.id })),
    ).rejects.toThrow("a commitment is required");
    await expect(
      logCommitment(fd({ text: "x", direction: "sideways", ownerId: staffUser.id })),
    ).rejects.toThrow("invalid direction");
    await expect(
      logCommitment(fd({ text: "x", direction: "we_owe", ownerId: "" })),
    ).rejects.toThrow("an owner is required");
  });

  test("refuses a we-owe owner who is not a member of this org", async () => {
    await expect(
      logCommitment(fd({ text: "x", direction: "we_owe", ownerId: outsiderUser.id })),
    ).rejects.toThrow("owner is not a member of this organization");
  });

  test("refuses a they-owe contact from another tenant", async () => {
    await expect(
      logCommitment(fd({ text: "x", direction: "they_owe", ownerId: contactBId })),
    ).rejects.toThrow("contact not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.actionItem.count({ where: { ownerContactId: contactBId } }),
    );
    expect(count).toBe(1);
  });
});

describe("editCommitment / updateCommitment", () => {
  test("edits text + due date, then advances status, scoped to the tenant", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: { id, orgId: orgA.id, text: "Old", status: "open", ownerUserId: staffUser.id },
      }),
    );

    await editCommitment(fd({ id, text: "New text", dueDate: "2026-09-15" }));
    let row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { text: true, dueDate: true, status: true } }),
    );
    expect(row!.text).toBe("New text");
    expect(row!.dueDate).not.toBeNull();

    await updateCommitment(fd({ id, status: "done" }));
    row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { text: true, dueDate: true, status: true } }),
    );
    expect(row!.status).toBe("done");
  });

  test("captures a completion note on done and clears it on reopen", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.create({
        data: { id, orgId: orgA.id, text: "Resolve", status: "open", ownerUserId: staffUser.id },
      }),
    );

    // Done with a note persists the note alongside the status.
    await updateCommitment(fd({ id, status: "done", note: "  Sent the signed docs.  " }));
    let row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { status: true, completionNote: true } }),
    );
    expect(row).toMatchObject({ status: "done", completionNote: "Sent the signed docs." });

    // Reopening (or any non-done transition) clears the stale note.
    await updateCommitment(fd({ id, status: "open", note: "ignored on reopen" }));
    row = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id }, select: { status: true, completionNote: true } }),
    );
    expect(row).toMatchObject({ status: "open", completionNote: null });
  });

  test("a foreign item id matches no row and leaves the other tenant untouched", async () => {
    await editCommitment(fd({ id: commitmentBId, text: "hijacked" }));
    await updateCommitment(fd({ id: commitmentBId, status: "dropped" }));

    const row = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId }, select: { text: true, status: true } }),
    );
    expect(row).toMatchObject({ text: "Beta's own commitment", status: "open" });
  });
});

describe("batchUpdateCommitments", () => {
  // Selected ids ride as repeated "ids" fields, plus the op.
  function batchFd(ids: string[], op: string): FormData {
    const f = new FormData();
    for (const id of ids) f.append("ids", id);
    f.set("op", op);
    return f;
  }

  async function seedOpen(): Promise<[string, string, string]> {
    const ids: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
    await withOrg(orgA.id, (tx) =>
      tx.actionItem.createMany({
        data: ids.map((id, i) => ({
          id,
          orgId: orgA.id,
          text: `Batch item ${i}`,
          status: "open",
          ownerUserId: staffUser.id,
        })),
      }),
    );
    return ids;
  }

  test("marks the selected items done and leaves the rest untouched", async () => {
    const [a, b, c] = await seedOpen();

    await batchUpdateCommitments(batchFd([a, b], "done"));

    const rows = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findMany({
        where: { id: { in: [a, b, c] } },
        select: { id: true, status: true },
      }),
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(a)).toBe("done");
    expect(byId.get(b)).toBe("done");
    expect(byId.get(c)).toBe("open");
  });

  test("deletes the selected items", async () => {
    const [a, b, c] = await seedOpen();

    await batchUpdateCommitments(batchFd([a, c], "delete"));

    const remaining = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findMany({
        where: { id: { in: [a, b, c] } },
        select: { id: true },
      }),
    );
    expect(remaining.map((r) => r.id)).toEqual([b]);
  });

  test("requires a non-empty selection and a valid op", async () => {
    const [a] = await seedOpen();
    await expect(batchUpdateCommitments(batchFd([], "done"))).rejects.toThrow(
      "no commitments selected",
    );
    await expect(batchUpdateCommitments(batchFd([a], "dropped"))).rejects.toThrow(
      "invalid batch operation",
    );
  });

  test("scopes the batch to the tenant — a foreign id in the set is left untouched", async () => {
    const [a] = await seedOpen();

    await batchUpdateCommitments(batchFd([a, commitmentBId], "delete"));

    const foreign = await withOrg(orgB.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: commitmentBId }, select: { status: true } }),
    );
    expect(foreign).not.toBeNull();
    const own = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: a }, select: { id: true } }),
    );
    expect(own).toBeNull();
  });
});
