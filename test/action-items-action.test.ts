import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for saveActionItems (gap-audit cluster A, F1
// hardening). Exercises the persist path against the real Neon DB — the auth
// boundary, the server-side owner re-validation, and the parent-reload guard —
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. The
// load-bearing assertion is the cardinal-rule fix: action_items.meeting_id is a
// single-column FK, so without a write-time reload an own-org item could be
// linked to ANOTHER org's meeting id. A foreign meeting must be refused, leaving
// no straddling orphan.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveActionItems } = await import("@/app/dashboard/meetings/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

let meetingAId: string;
let meetingBId: string;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: staffUser });
  // Staff owner candidate for org A only.
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "staff" },
  });

  meetingAId = await withOrg(orgA.id, async (tx) => {
    const m = await tx.meeting.create({
      data: {
        orgId: orgA.id,
        title: "Q3 check-in (A)",
        heldAt: new Date("2026-06-01T15:00:00Z"),
        summary: "Discussed the IDA application.",
      },
    });
    return m.id;
  });

  meetingBId = await withOrg(orgB.id, async (tx) => {
    const m = await tx.meeting.create({
      data: {
        orgId: orgB.id,
        title: "Foreign meeting (B)",
        heldAt: new Date("2026-06-02T15:00:00Z"),
      },
    });
    return m.id;
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(meetingId: string, items: unknown): FormData {
  const f = new FormData();
  f.set("meetingId", meetingId);
  f.set("items", JSON.stringify(items));
  return f;
}

async function itemsForMeeting(orgId: string, meetingId: string) {
  return withOrg(orgId, (tx) =>
    tx.actionItem.findMany({
      where: { meetingId },
      select: { text: true, ownerUserId: true },
    }),
  );
}

describe("saveActionItems action", () => {
  test("persists a confirmed staff-owned item on the caller's own meeting", async () => {
    mockCtx.orgId = orgA.id;
    await saveActionItems(
      fd(meetingAId, [
        { text: "Send the IDA draft", ownerKind: "staff", ownerId: staffUser.id },
      ]),
    );

    const rows = await itemsForMeeting(orgA.id, meetingAId);
    expect(rows).toEqual([
      { text: "Send the IDA draft", ownerUserId: staffUser.id },
    ]);
  });

  test("refuses to link items to another org's meeting id (F1)", async () => {
    // Org A staff owner is valid, but the meeting belongs to org B. Before the
    // parent-reload guard the staff-owned row would persist as an own-org item
    // pointing at org B's meeting — a tenant-straddling orphan.
    mockCtx.orgId = orgA.id;
    await expect(
      saveActionItems(
        fd(meetingBId, [
          { text: "Sneak onto B", ownerKind: "staff", ownerId: staffUser.id },
        ]),
      ),
    ).rejects.toThrow("meeting not found in this organization");

    // No org-A item was linked to org B's meeting…
    expect(await itemsForMeeting(orgA.id, meetingBId)).toEqual([]);
    // …and org B's meeting has no items either.
    expect(await itemsForMeeting(orgB.id, meetingBId)).toEqual([]);
  });
});
