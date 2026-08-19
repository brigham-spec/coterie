import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the soft-delete / recover slice. Runs
// against the real Neon DB, mocking only Clerk (requireOrgContext/requireAdmin)
// and Next's cache/navigation helpers. Proves that deleting a company or
// contact SNAPSHOTS its full entangled subgraph into deleted_records then
// hard-deletes it from the live tables, that restoreRecord replays that
// snapshot back verbatim (original ids preserved) and drops the trash row, and
// — the cardinal rule — that a foreign deletedRecordId is refused via RLS.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { deleteCompany } = await import("@/app/dashboard/companies/[id]/actions");
const { removeContact } = await import("@/app/dashboard/contacts/actions");
const { restoreRecord } = await import("@/app/dashboard/settings/deleted/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@a.test`,
  name: "Staff A",
};

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await prisma.user.create({ data: staffUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "admin" },
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: staffUser.id } });
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

// Seed a company plus its entangled subgraph and return the ids we assert on.
async function seedCompanySubgraph(): Promise<{
  companyId: string;
  c1: string;
  c2: string;
  meetingId: string;
  introId: string;
  newsId: string;
  activityId: string;
  scopedItemId: string;
  orphanItemId: string;
}> {
  return withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: `Deletable Co ${randomUUID()}`,
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
        contacts: {
          create: [
            { orgId: orgA.id, name: "First Person", isPrimary: true },
            { orgId: orgA.id, name: "Second Person" },
          ],
        },
      },
      include: { contacts: true },
    });
    const [c1, c2] = company.contacts;

    const intro = await tx.introduction.create({
      data: {
        orgId: orgA.id,
        partyAContactId: c1.id,
        partyBContactId: c2.id,
        status: "suggested",
        source: "manual",
      },
    });
    const meeting = await tx.meeting.create({
      data: { orgId: orgA.id, title: "Kickoff", heldAt: new Date() },
    });
    await tx.meetingAttendee.create({
      data: {
        orgId: orgA.id,
        meetingId: meeting.id,
        contactId: c1.id,
        matchMethod: "manual",
        confidence: 1,
        confirmed: true,
      },
    });
    const news = await tx.newsItem.create({
      data: {
        orgId: orgA.id,
        companyId: company.id,
        headline: "In the news",
        url: `https://news.test/${randomUUID()}`,
        capturedAt: new Date(),
      },
    });
    const activity = await tx.activity.create({
      data: {
        orgId: orgA.id,
        companyId: company.id,
        type: "status_changed",
        payload: { from: null, to: "member" },
        occurredAt: new Date(),
      },
    });
    // Owner-XOR: an item owned by a contact (no companyId) is a RESTRICT child
    // that softDeleteCompany must pre-delete.
    const orphanItem = await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meeting.id,
        text: "They owe us documents",
        ownerContactId: c1.id,
        status: "open",
      },
    });
    const scopedItem = await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        companyId: company.id,
        text: "We owe a follow-up",
        ownerUserId: staffUser.id,
        status: "open",
      },
    });

    return {
      companyId: company.id,
      c1: c1.id,
      c2: c2.id,
      meetingId: meeting.id,
      introId: intro.id,
      newsId: news.id,
      activityId: activity.id,
      scopedItemId: scopedItem.id,
      orphanItemId: orphanItem.id,
    };
  });
}

async function countCompanySubgraph(s: {
  companyId: string;
  c1: string;
  c2: string;
  meetingId: string;
  introId: string;
  newsId: string;
  activityId: string;
  scopedItemId: string;
  orphanItemId: string;
}) {
  return withOrg(orgA.id, async (tx) => ({
    company: await tx.company.count({ where: { id: s.companyId } }),
    contacts: await tx.contact.count({ where: { id: { in: [s.c1, s.c2] } } }),
    intro: await tx.introduction.count({ where: { id: s.introId } }),
    attendees: await tx.meetingAttendee.count({
      where: { meetingId: s.meetingId, contactId: s.c1 },
    }),
    news: await tx.newsItem.count({ where: { id: s.newsId } }),
    activity: await tx.activity.count({ where: { id: s.activityId } }),
    meeting: await tx.meeting.count({ where: { id: s.meetingId } }),
    scopedItem: await tx.actionItem.count({ where: { id: s.scopedItemId } }),
    orphanItem: await tx.actionItem.count({ where: { id: s.orphanItemId } }),
  }));
}

describe("deleteCompany + restoreRecord (full subgraph round-trip)", () => {
  test("snapshots the subgraph, hard-deletes it, then restores it verbatim with original ids", async () => {
    const s = await seedCompanySubgraph();

    // Pre-delete: everything present (meeting has no companyId, so it isn't part
    // of the company snapshot — the attendee link is).
    expect(await countCompanySubgraph(s)).toEqual({
      company: 1,
      contacts: 2,
      intro: 1,
      attendees: 1,
      news: 1,
      activity: 1,
      meeting: 1,
      scopedItem: 1,
      orphanItem: 1,
    });

    await deleteCompany(fd({ companyId: s.companyId }));

    // A trash row was written for this record.
    const snapshotRow = await withOrg(orgA.id, (tx) =>
      tx.deletedRecord.findFirst({
        where: { recordId: s.companyId },
        select: { id: true, kind: true, label: true },
      }),
    );
    expect(snapshotRow).not.toBeNull();
    expect(snapshotRow!.kind).toBe("company");

    // Live subgraph is gone (only the parentless Meeting survives).
    expect(await countCompanySubgraph(s)).toEqual({
      company: 0,
      contacts: 0,
      intro: 0,
      attendees: 0,
      news: 0,
      activity: 0,
      meeting: 1,
      scopedItem: 0,
      orphanItem: 0,
    });

    // Recover replays the snapshot back — original ids preserved.
    await restoreRecord(fd({ deletedRecordId: snapshotRow!.id }));

    expect(await countCompanySubgraph(s)).toEqual({
      company: 1,
      contacts: 2,
      intro: 1,
      attendees: 1,
      news: 1,
      activity: 1,
      meeting: 1,
      scopedItem: 1,
      orphanItem: 1,
    });

    // The trash row is dropped once restored.
    const afterRestore = await withOrg(orgA.id, (tx) =>
      tx.deletedRecord.findUnique({ where: { id: snapshotRow!.id } }),
    );
    expect(afterRestore).toBeNull();

    // Cleanup: hard-remove the restored company + orphan meeting.
    await withOrg(orgA.id, async (tx) => {
      await tx.introduction.deleteMany({ where: { id: s.introId } });
      await tx.actionItem.deleteMany({ where: { id: { in: [s.scopedItemId, s.orphanItemId] } } });
      await tx.company.delete({ where: { id: s.companyId } });
      await tx.meeting.delete({ where: { id: s.meetingId } });
    });
  });

  test("refuses a company id from another tenant", async () => {
    const companyBId = randomUUID();
    await withOrg(orgB.id, (tx) =>
      tx.company.create({
        data: {
          id: companyBId,
          orgId: orgB.id,
          name: "Beta Corp",
          status: "member",
          industry: "Legal",
          annualValue: 1000,
        },
      }),
    );

    await expect(deleteCompany(fd({ companyId: companyBId }))).rejects.toThrow(
      "company not found in this organization",
    );

    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.company.count({ where: { id: companyBId } }),
    );
    expect(stillThere).toBe(1);

    await withOrg(orgB.id, (tx) => tx.company.delete({ where: { id: companyBId } }));
  });
});

describe("removeContact + restoreRecord (contact subgraph round-trip)", () => {
  test("snapshots the contact subgraph, hard-deletes it, then restores it", async () => {
    const companyId = randomUUID();
    const contactId = randomUUID();
    const otherContactId = randomUUID();
    const seeded = await withOrg(orgA.id, async (tx) => {
      await tx.company.create({
        data: {
          id: companyId,
          orgId: orgA.id,
          name: `Contact Co ${randomUUID()}`,
          status: "member",
          industry: "Manufacturing",
          annualValue: 1000,
        },
      });
      await tx.contact.create({
        data: { id: contactId, orgId: orgA.id, companyId, name: "Deletable Person" },
      });
      await tx.contact.create({
        data: { id: otherContactId, orgId: orgA.id, companyId, name: "Counterparty" },
      });
      const meeting = await tx.meeting.create({
        data: { orgId: orgA.id, title: "Sync", heldAt: new Date() },
      });
      await tx.meetingAttendee.create({
        data: {
          orgId: orgA.id,
          meetingId: meeting.id,
          contactId,
          matchMethod: "manual",
          confidence: 1,
          confirmed: true,
        },
      });
      const intro = await tx.introduction.create({
        data: {
          orgId: orgA.id,
          partyAContactId: contactId,
          partyBContactId: otherContactId,
          status: "suggested",
          source: "manual",
        },
      });
      const item = await tx.actionItem.create({
        data: {
          orgId: orgA.id,
          meetingId: meeting.id,
          text: "Owned by the doomed contact",
          ownerContactId: contactId,
          status: "open",
        },
      });
      return { meetingId: meeting.id, introId: intro.id, itemId: item.id };
    });

    await removeContact(fd({ contactId }));

    const snapshotRow = await withOrg(orgA.id, (tx) =>
      tx.deletedRecord.findFirst({
        where: { recordId: contactId },
        select: { id: true, kind: true },
      }),
    );
    expect(snapshotRow).not.toBeNull();
    expect(snapshotRow!.kind).toBe("contact");

    // The contact + its RESTRICT children are gone; the parent company and the
    // counterparty contact remain.
    const afterDelete = await withOrg(orgA.id, async (tx) => ({
      contact: await tx.contact.count({ where: { id: contactId } }),
      other: await tx.contact.count({ where: { id: otherContactId } }),
      intro: await tx.introduction.count({ where: { id: seeded.introId } }),
      attendee: await tx.meetingAttendee.count({
        where: { meetingId: seeded.meetingId, contactId },
      }),
      item: await tx.actionItem.count({ where: { id: seeded.itemId } }),
    }));
    expect(afterDelete).toEqual({ contact: 0, other: 1, intro: 0, attendee: 0, item: 0 });

    await restoreRecord(fd({ deletedRecordId: snapshotRow!.id }));

    const afterRestore = await withOrg(orgA.id, async (tx) => ({
      contact: await tx.contact.count({ where: { id: contactId } }),
      intro: await tx.introduction.count({ where: { id: seeded.introId } }),
      attendee: await tx.meetingAttendee.count({
        where: { meetingId: seeded.meetingId, contactId },
      }),
      item: await tx.actionItem.count({ where: { id: seeded.itemId } }),
      trash: await tx.deletedRecord.count({ where: { id: snapshotRow!.id } }),
    }));
    expect(afterRestore).toEqual({ contact: 1, intro: 1, attendee: 1, item: 1, trash: 0 });

    await withOrg(orgA.id, async (tx) => {
      await tx.introduction.deleteMany({ where: { id: seeded.introId } });
      await tx.actionItem.deleteMany({ where: { id: seeded.itemId } });
      await tx.company.delete({ where: { id: companyId } });
      await tx.meeting.delete({ where: { id: seeded.meetingId } });
    });
  });

  test("refuses a contact id from another tenant", async () => {
    const companyBId = randomUUID();
    const contactBId = randomUUID();
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
        data: { id: contactBId, orgId: orgB.id, companyId: companyBId, name: "Beta Person" },
      });
    });

    await expect(removeContact(fd({ contactId: contactBId }))).rejects.toThrow(
      "contact not found in this organization",
    );

    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.contact.count({ where: { id: contactBId } }),
    );
    expect(stillThere).toBe(1);

    await withOrg(orgB.id, (tx) => tx.company.delete({ where: { id: companyBId } }));
  });
});

describe("restoreRecord tenant isolation", () => {
  test("refuses a deleted_records id from another tenant", async () => {
    // Delete a company in orgB so a real trash row exists there.
    const companyBId = randomUUID();
    await withOrg(orgB.id, (tx) =>
      tx.company.create({
        data: {
          id: companyBId,
          orgId: orgB.id,
          name: `Beta Deletable ${randomUUID()}`,
          status: "member",
          industry: "Legal",
          annualValue: 1000,
        },
      }),
    );

    // deleteCompany runs as orgA (mockCtx); flip context to orgB for this delete.
    mockCtx.orgId = orgB.id;
    mockCtx.orgName = orgB.name;
    try {
      await deleteCompany(fd({ companyId: companyBId }));
    } finally {
      mockCtx.orgId = orgA.id;
      mockCtx.orgName = orgA.name;
    }

    const orgBTrash = await withOrg(orgB.id, (tx) =>
      tx.deletedRecord.findFirst({ where: { recordId: companyBId }, select: { id: true } }),
    );
    expect(orgBTrash).not.toBeNull();

    // As orgA, restoring orgB's trash id is refused (RLS hides it → null → false).
    await expect(
      restoreRecord(fd({ deletedRecordId: orgBTrash!.id })),
    ).rejects.toThrow("record not found in this organization");

    // orgB's snapshot is untouched and still restorable in its own tenant.
    const stillTrash = await withOrg(orgB.id, (tx) =>
      tx.deletedRecord.count({ where: { id: orgBTrash!.id } }),
    );
    expect(stillTrash).toBe(1);

    await withOrg(orgB.id, (tx) =>
      tx.deletedRecord.delete({ where: { id: orgBTrash!.id } }),
    );
  });
});
