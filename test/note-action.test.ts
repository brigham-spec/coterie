import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the S8c relationship-notes slice (addNote +
// editNote + deleteNote). Runs against the real Neon DB, mocking only Clerk
// (requireOrgContext) and Next's revalidatePath. Proves the authored write, the
// empty-body guard, the date default/keep behaviour on edit, and that a foreign
// company id (add) or note id (edit/delete) is refused by RLS and leaves the
// other tenant untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({
  orgId: "",
  orgName: "",
  userId: "",
  userName: "",
}));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { addNote, editNote, deleteNote } = await import(
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
const companyBId = randomUUID();
// A seeded orgB note — the foreign target for the edit/delete-refusal tests.
const noteBId = randomUUID();

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
        status: "member",
        industry: "Manufacturing",
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
    await tx.note.create({
      data: {
        id: noteBId,
        orgId: orgB.id,
        companyId: companyBId,
        body: "Beta's own note",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addNote", () => {
  test("records a note under its company, dated and attributed", async () => {
    const result = await addNote(
      fd({
        companyId: companyAId,
        body: "Called about the Q3 grant.",
        occurredAt: "2026-06-01",
      }),
    );
    expect(result.status).toBe("saved");

    const note = await withOrg(orgA.id, (tx) =>
      tx.note.findFirst({
        where: { companyId: companyAId },
        select: { body: true, actorUserId: true, occurredAt: true },
      }),
    );
    expect(note!.body).toBe("Called about the Q3 grant.");
    expect(note!.actorUserId).toBe(staffUser.id);
    expect(note!.occurredAt.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  test("rejects an empty body without writing", async () => {
    const before = await withOrg(orgA.id, (tx) =>
      tx.note.count({ where: { companyId: companyAId } }),
    );
    const result = await addNote(fd({ companyId: companyAId, body: "   " }));
    expect(result).toEqual({
      status: "error",
      message: "A note can't be empty.",
    });
    const after = await withOrg(orgA.id, (tx) =>
      tx.note.count({ where: { companyId: companyAId } }),
    );
    expect(after).toBe(before);
  });

  test("refuses a company id from another tenant", async () => {
    const result = await addNote(
      fd({ companyId: companyBId, body: "hijack" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    // Only the seeded Beta note remains — no foreign write landed.
    const count = await withOrg(orgB.id, (tx) =>
      tx.note.count({ where: { companyId: companyBId } }),
    );
    expect(count).toBe(1);
  });
});

describe("editNote", () => {
  test("updates body and date, and keeps the date when left blank", async () => {
    const noteId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.note.create({
        data: {
          id: noteId,
          orgId: orgA.id,
          companyId: companyAId,
          body: "original",
          occurredAt: new Date("2026-02-01T00:00:00Z"),
        },
      }),
    );

    const withDate = await editNote(
      fd({ noteId, body: "revised", occurredAt: "2026-03-15" }),
    );
    expect(withDate.status).toBe("saved");
    const afterDate = await withOrg(orgA.id, (tx) =>
      tx.note.findUnique({
        where: { id: noteId },
        select: { body: true, occurredAt: true },
      }),
    );
    expect(afterDate!.body).toBe("revised");
    expect(afterDate!.occurredAt.toISOString().slice(0, 10)).toBe("2026-03-15");

    // A blank date leaves the stored occurredAt intact, only the body changes.
    await editNote(fd({ noteId, body: "revised again" }));
    const afterBlank = await withOrg(orgA.id, (tx) =>
      tx.note.findUnique({
        where: { id: noteId },
        select: { body: true, occurredAt: true },
      }),
    );
    expect(afterBlank!.body).toBe("revised again");
    expect(afterBlank!.occurredAt.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  test("rejects an empty body", async () => {
    const result = await editNote(fd({ noteId: randomUUID(), body: " " }));
    expect(result).toEqual({
      status: "error",
      message: "A note can't be empty.",
    });
  });

  test("refuses a note id from another tenant and leaves it untouched", async () => {
    const result = await editNote(fd({ noteId: noteBId, body: "hijack" }));
    expect(result).toEqual({
      status: "error",
      message: "note not found in this organization",
    });
    const still = await withOrg(orgB.id, (tx) =>
      tx.note.findUnique({ where: { id: noteBId }, select: { body: true } }),
    );
    expect(still!.body).toBe("Beta's own note");
  });
});

describe("deleteNote", () => {
  test("deletes a note scoped to the tenant", async () => {
    const noteId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.note.create({
        data: {
          id: noteId,
          orgId: orgA.id,
          companyId: companyAId,
          body: "to be deleted",
          occurredAt: new Date("2026-04-01T00:00:00Z"),
        },
      }),
    );

    await deleteNote(fd({ noteId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.note.findUnique({ where: { id: noteId } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses a note id from another tenant and leaves it untouched", async () => {
    await expect(deleteNote(fd({ noteId: noteBId }))).rejects.toThrow(
      "note not found in this organization",
    );
    const still = await withOrg(orgB.id, (tx) =>
      tx.note.findUnique({ where: { id: noteBId } }),
    );
    expect(still).not.toBeNull();
  });
});
