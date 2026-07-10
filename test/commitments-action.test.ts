import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for updateCommitment (slice 11.10). Exercises the
// whole server-action path against the real Neon DB — the auth boundary and the
// RLS-scoped withOrg update — mocking only Clerk (requireOrgContext) and Next's
// revalidatePath. The load-bearing assertion is tenant isolation: org B must not
// be able to advance org A's commitment (RLS → updateMany matches 0 rows, no error).

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateCommitment } = await import("@/app/dashboard/commitments/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const base = { industry: "test", annualValue: 1000 };

let itemAId: string;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  itemAId = await withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: { orgId: orgA.id, name: "Acme (A)", status: "member", ...base },
    });
    const contact = await tx.contact.create({
      data: { orgId: orgA.id, companyId: company.id, name: "Guest (A)" },
    });
    const item = await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        text: "Send the deck",
        status: "open",
        ownerContactId: contact.id,
      },
    });
    return item.id;
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function fd(id: string, status: string): FormData {
  const f = new FormData();
  f.set("id", id);
  f.set("status", status);
  return f;
}

async function statusOf(id: string): Promise<string | undefined> {
  const row = await withOrg(orgA.id, (tx) =>
    tx.actionItem.findUnique({ where: { id }, select: { status: true } }),
  );
  return row?.status;
}

describe("updateCommitment action", () => {
  test("marks the caller's own commitment done", async () => {
    mockCtx.orgId = orgA.id;
    await updateCommitment(fd(itemAId, "done"));
    expect(await statusOf(itemAId)).toBe("done");
  });

  test("org B cannot advance org A's commitment (RLS isolation)", async () => {
    // Reset to open as org A, then attempt the update as org B.
    mockCtx.orgId = orgA.id;
    await updateCommitment(fd(itemAId, "open"));
    expect(await statusOf(itemAId)).toBe("open");

    mockCtx.orgId = orgB.id;
    await updateCommitment(fd(itemAId, "done"));

    // The foreign id matched no row under org B's RLS scope — item stays open.
    expect(await statusOf(itemAId)).toBe("open");
  });

  test("rejects an out-of-range status before touching the DB", async () => {
    mockCtx.orgId = orgA.id;
    await expect(updateCommitment(fd(itemAId, "archived"))).rejects.toThrow(
      "invalid status",
    );
    expect(await statusOf(itemAId)).toBe("open");
  });
});
