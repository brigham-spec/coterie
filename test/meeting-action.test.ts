import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the manual-meeting slice on the company
// profile (logMeeting + deleteMeeting). Runs against the real Neon DB, mocking
// only Clerk (requireOrgContext) and Next's revalidatePath. Proves a manual
// meeting is created with confirmed "manual" attendee rows for this company's
// contacts, that a foreign company or a non-contact attendee is refused, that
// removal is limited to manual meetings (a synced one survives), and that a
// foreign meeting id leaves the other tenant untouched (RLS).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { logMeeting, deleteMeeting } = await import(
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
const contactA1Id = randomUUID();
const contactA2Id = randomUUID();

const companyBId = randomUUID();
const contactBId = randomUUID();
// A seeded orgB manual meeting — the foreign target for the delete refusal.
const meetingBId = randomUUID();

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
    await tx.contact.createMany({
      data: [
        { id: contactA1Id, orgId: orgA.id, companyId: companyAId, name: "Ada Acme" },
        { id: contactA2Id, orgId: orgA.id, companyId: companyAId, name: "Ben Acme" },
      ],
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
    await tx.meeting.create({
      data: {
        id: meetingBId,
        orgId: orgB.id,
        title: "Beta's own meeting",
        heldAt: new Date(),
        attendees: {
          create: [
            {
              contactId: contactBId,
              matchMethod: "manual",
              confidence: 1,
              confirmed: true,
            },
          ],
        },
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
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("logMeeting", () => {
  test("creates a meeting with confirmed manual attendee rows for this company", async () => {
    await logMeeting(
      fd({
        companyId: companyAId,
        title: "Site visit",
        heldAt: "2026-08-01",
        summary: "Toured the mill floor.",
        attendeeIds: [contactA1Id, contactA2Id],
      }),
    );

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { title: "Site visit" },
        select: {
          summary: true,
          firefliesId: true,
          heldAt: true,
          attendees: {
            select: { contactId: true, matchMethod: true, confirmed: true },
          },
        },
      }),
    );
    expect(meeting).not.toBeNull();
    expect(meeting!.summary).toBe("Toured the mill floor.");
    expect(meeting!.firefliesId).toBeNull();
    expect(meeting!.attendees).toHaveLength(2);
    expect(meeting!.attendees.every((a) => a.confirmed && a.matchMethod === "manual")).toBe(true);
    expect(new Set(meeting!.attendees.map((a) => a.contactId))).toEqual(
      new Set([contactA1Id, contactA2Id]),
    );
  });

  test("defaults heldAt to now when the date is empty", async () => {
    const before = Date.now();
    await logMeeting(
      fd({ companyId: companyAId, title: "Undated sync", attendeeIds: [contactA1Id] }),
    );
    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({ where: { title: "Undated sync" }, select: { heldAt: true } }),
    );
    expect(meeting!.heldAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("requires a title", async () => {
    const state = await logMeeting(
      fd({ companyId: companyAId, title: "  ", attendeeIds: [contactA1Id] }),
    );
    expect(state).toEqual({ status: "error", message: "A meeting title is required." });
  });

  test("requires at least one attendee", async () => {
    const state = await logMeeting(fd({ companyId: companyAId, title: "Empty" }));
    expect(state).toEqual({ status: "error", message: "Select at least one attendee." });
  });

  test("refuses a company id from another tenant", async () => {
    const state = await logMeeting(
      fd({ companyId: companyBId, title: "hijack", attendeeIds: [contactBId] }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
  });

  test("refuses an attendee who is not a contact of this company", async () => {
    const state = await logMeeting(
      fd({ companyId: companyAId, title: "Mixed", attendeeIds: [contactA1Id, contactBId] }),
    );
    expect(state).toEqual({
      status: "error",
      message: "An attendee is not a contact on this company.",
    });
  });
});

describe("deleteMeeting", () => {
  test("removes a manual meeting scoped to the tenant (attendees cascade)", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.meeting.create({
        data: {
          id,
          orgId: orgA.id,
          title: "Disposable",
          heldAt: new Date(),
          attendees: {
            create: [
              {
                contactId: contactA1Id,
                matchMethod: "manual",
                confidence: 1,
                confirmed: true,
              },
            ],
          },
        },
      }),
    );

    await deleteMeeting(fd({ id, companyId: companyAId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.meeting.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
    const attendees = await withOrg(orgA.id, (tx) =>
      tx.meetingAttendee.count({ where: { meetingId: id } }),
    );
    expect(attendees).toBe(0);
  });

  test("does not remove a synced meeting (firefliesId set)", async () => {
    const id = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.meeting.create({
        data: {
          id,
          orgId: orgA.id,
          firefliesId: `ff_${randomUUID()}`,
          title: "Synced",
          heldAt: new Date(),
        },
      }),
    );

    await deleteMeeting(fd({ id, companyId: companyAId }));

    const still = await withOrg(orgA.id, (tx) =>
      tx.meeting.findUnique({ where: { id }, select: { title: true } }),
    );
    expect(still!.title).toBe("Synced");
  });

  test("a foreign meeting id leaves the other tenant untouched", async () => {
    await deleteMeeting(fd({ id: meetingBId, companyId: companyAId }));

    const still = await withOrg(orgB.id, (tx) =>
      tx.meeting.findUnique({ where: { id: meetingBId }, select: { title: true } }),
    );
    expect(still!.title).toBe("Beta's own meeting");
  });
});
