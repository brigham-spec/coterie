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

const { saveActionItems, editActionItem, logManualMeeting } = await import(
  "@/app/dashboard/meetings/actions"
);

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

// Two companies in org A (each with a contact) prove the global log spans the
// network — unlike the profile log, one meeting can carry attendees from
// different companies. A contact in org B is the cross-tenant refusal target.
const companyA1Id = randomUUID();
const companyA2Id = randomUUID();
const contactA1Id = randomUUID();
const contactA2Id = randomUUID();
const companyBId = randomUUID();
const contactBId = randomUUID();

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

  await withOrg(orgA.id, async (tx) => {
    await tx.company.createMany({
      data: [
        { id: companyA1Id, orgId: orgA.id, name: "Acme Mills", status: "member", industry: "Manufacturing", annualValue: 1000 },
        { id: companyA2Id, orgId: orgA.id, name: "Beacon Bank", status: "member", industry: "Finance", annualValue: 1000 },
      ],
    });
    await tx.contact.createMany({
      data: [
        { id: contactA1Id, orgId: orgA.id, companyId: companyA1Id, name: "Ada Acme" },
        { id: contactA2Id, orgId: orgA.id, companyId: companyA2Id, name: "Ben Beacon" },
      ],
    });
  });

  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: { id: companyBId, orgId: orgB.id, name: "Beta Corp", status: "member", industry: "Legal", annualValue: 1000 },
    });
    await tx.contact.create({
      data: { id: contactBId, orgId: orgB.id, companyId: companyBId, name: "Bob Beta" },
    });
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

  test("cross-attributes to a network member who did not attend (Meet 12)", async () => {
    // contactA1 is a contact of company A1 but was NOT an attendee of meetingA.
    // The widened owner pool lets the item be attributed to her, so it will
    // surface on her company profile as a "they owe" deliverable.
    mockCtx.orgId = orgA.id;
    await saveActionItems(
      fd(meetingAId, [
        { text: "Ada to send the site plan", ownerKind: "contact", ownerId: contactA1Id },
      ]),
    );

    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { meetingId: meetingAId, ownerContactId: contactA1Id },
        select: { text: true, ownerUserId: true, ownerContactId: true },
      }),
    );
    expect(item).toEqual({
      text: "Ada to send the site plan",
      ownerUserId: null,
      ownerContactId: contactA1Id,
    });
  });

  test("drops an item attributed to a contact from another tenant", async () => {
    // contactB belongs to org B — outside this network, so not a valid owner
    // here. It is the only item, so nothing is written.
    mockCtx.orgId = orgA.id;
    await saveActionItems(
      fd(meetingAId, [
        { text: "Foreign owner", ownerKind: "contact", ownerId: contactBId },
      ]),
    );
    const leaked = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({
        where: { meetingId: meetingAId, ownerContactId: contactBId },
        select: { id: true },
      }),
    );
    expect(leaked).toBeNull();
  });
});

function editFd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("editActionItem action", () => {
  // Seed a fresh staff-owned item to correct, so these tests don't depend on
  // ordering against the saveActionItems block above.
  let itemId: string;
  beforeAll(async () => {
    itemId = await withOrg(orgA.id, async (tx) => {
      const it = await tx.actionItem.create({
        data: {
          orgId: orgA.id,
          meetingId: meetingAId,
          text: "Original wording",
          ownerUserId: staffUser.id,
        },
      });
      return it.id;
    });
  });

  async function itemRow(id: string) {
    return withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({
        where: { id },
        select: { text: true, ownerUserId: true, ownerContactId: true },
      }),
    );
  }

  test("corrects the text and reassigns to a network contact (clears staff)", async () => {
    mockCtx.orgId = orgA.id;
    await editActionItem(
      editFd({
        id: itemId,
        text: "Corrected wording",
        ownerKind: "contact",
        ownerId: contactA1Id,
      }),
    );
    expect(await itemRow(itemId)).toEqual({
      text: "Corrected wording",
      ownerUserId: null,
      ownerContactId: contactA1Id,
    });
  });

  test("reassigns back to a staff owner (clears contact)", async () => {
    mockCtx.orgId = orgA.id;
    await editActionItem(
      editFd({
        id: itemId,
        text: "Corrected wording",
        ownerKind: "staff",
        ownerId: staffUser.id,
      }),
    );
    expect(await itemRow(itemId)).toEqual({
      text: "Corrected wording",
      ownerUserId: staffUser.id,
      ownerContactId: null,
    });
  });

  test("refuses a foreign-tenant contact owner, leaving the row untouched", async () => {
    mockCtx.orgId = orgA.id;
    await expect(
      editActionItem(
        editFd({
          id: itemId,
          text: "Should not persist",
          ownerKind: "contact",
          ownerId: contactBId,
        }),
      ),
    ).rejects.toThrow("contact not found in this organization");
    expect(await itemRow(itemId)).toEqual({
      text: "Corrected wording",
      ownerUserId: staffUser.id,
      ownerContactId: null,
    });
  });

  test("rejects a blank owner", async () => {
    mockCtx.orgId = orgA.id;
    await expect(
      editActionItem(editFd({ id: itemId, text: "x", ownerKind: "staff", ownerId: "" })),
    ).rejects.toThrow("an owner is required");
  });
});

function logFd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("logManualMeeting action", () => {
  test("logs a network-wide meeting with attendees from different companies", async () => {
    mockCtx.orgId = orgA.id;
    const state = await logManualMeeting(
      logFd({
        title: "Cross-company sync",
        heldAt: "2026-08-01",
        durationMinutes: "45",
        location: "Poughkeepsie, in-person",
        summary: "Introduced the two members.",
        attendeeIds: [contactA1Id, contactA2Id],
      }),
    );
    expect(state).toEqual({ status: "saved" });

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { title: "Cross-company sync" },
        select: {
          durationMinutes: true,
          location: true,
          firefliesId: true,
          attendees: { select: { contactId: true, matchMethod: true, confirmed: true } },
        },
      }),
    );
    expect(meeting!.durationMinutes).toBe(45);
    expect(meeting!.location).toBe("Poughkeepsie, in-person");
    expect(meeting!.firefliesId).toBeNull();
    expect(meeting!.attendees).toHaveLength(2);
    expect(
      meeting!.attendees.every((a) => a.confirmed && a.matchMethod === "manual"),
    ).toBe(true);
    expect(new Set(meeting!.attendees.map((a) => a.contactId))).toEqual(
      new Set([contactA1Id, contactA2Id]),
    );
  });

  test("requires a title", async () => {
    mockCtx.orgId = orgA.id;
    expect(
      await logManualMeeting(logFd({ title: "  ", attendeeIds: [contactA1Id] })),
    ).toEqual({ status: "error", message: "A meeting title is required." });
  });

  test("requires at least one attendee", async () => {
    mockCtx.orgId = orgA.id;
    expect(await logManualMeeting(logFd({ title: "Empty" }))).toEqual({
      status: "error",
      message: "Select at least one attendee.",
    });
  });

  test("refuses an attendee from another tenant, writing nothing", async () => {
    mockCtx.orgId = orgA.id;
    const state = await logManualMeeting(
      logFd({ title: "Hijack", attendeeIds: [contactA1Id, contactBId] }),
    );
    expect(state).toEqual({
      status: "error",
      message: "An attendee is not a contact in this network.",
    });

    const leaked = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({ where: { title: "Hijack" }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });
});
