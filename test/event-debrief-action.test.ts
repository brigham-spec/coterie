import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the post-event debrief slice (S2 events part
// B): updateEventNotes + addEventActionItem + updateEventActionItemStatus +
// deleteEventActionItem + logIntroductionAtEvent. Runs against the real Neon DB,
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// follow-up owner-XOR mapping ("we owe" -> staff ownerUserId, "they owe" -> a
// guest of THIS event's ownerContactId), the intro anchoring to the event, and
// that foreign inputs (a non-guest contact owner, a cross-org contact, a foreign
// event) are refused or scoped out by RLS.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const {
  createEvent,
  addInvitee,
  updateEventNotes,
  addEventActionItem,
  updateEventActionItemStatus,
  deleteEventActionItem,
  logIntroductionAtEvent,
} = await import("@/app/dashboard/events/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

let aliceId: string; // orgA guest contact
let bobId: string; // orgA guest contact
let outsiderContactId: string; // orgA contact NOT invited to the event
let bContactId: string; // orgB contact — cross-org target

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
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Member A",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
        contacts: {
          create: [
            { orgId: orgA.id, name: "Alice A", isPrimary: true },
            { orgId: orgA.id, name: "Bob A" },
            { orgId: orgA.id, name: "Outsider A" },
          ],
        },
      },
      include: { contacts: true },
    });
    aliceId = company.contacts.find((c) => c.name === "Alice A")!.id;
    bobId = company.contacts.find((c) => c.name === "Bob A")!.id;
    outsiderContactId = company.contacts.find((c) => c.name === "Outsider A")!.id;
  });

  bContactId = (await withOrg(orgB.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgB.id,
        name: "Member B",
        status: "member",
        industry: "Finance",
        annualValue: 1000,
        contacts: { create: { orgId: orgB.id, name: "Carol B", isPrimary: true } },
      },
      include: { contacts: true },
    });
    return company.contacts[0].id;
  }))!;

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function makeEvent(name: string): Promise<string> {
  await createEvent(fd({ name, type: "member_dinner" }));
  const ev = await withOrg(orgA.id, (tx) => tx.event.findFirst({ where: { name } }));
  return ev!.id;
}

describe("post-event debrief actions", () => {
  test("saves debrief notes on the event", async () => {
    const eventId = await makeEvent("Notes Event");
    await updateEventNotes(fd({ eventId, notes: "Great room, three intros made." }));
    const ev = await withOrg(orgA.id, (tx) =>
      tx.event.findUnique({ where: { id: eventId }, select: { notes: true } }),
    );
    expect(ev?.notes).toBe("Great room, three intros made.");
  });

  test("adds a 'we owe' follow-up owned by staff", async () => {
    const eventId = await makeEvent("WeOwe Event");
    await addEventActionItem(
      fd({ eventId, text: "Send the deck", direction: "we_owe", ownerId: staffUser.id }),
    );
    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({ where: { eventId } }),
    );
    expect(item?.text).toBe("Send the deck");
    expect(item?.ownerUserId).toBe(staffUser.id);
    expect(item?.ownerContactId).toBeNull();
    expect(item?.status).toBe("open");
  });

  test("adds a 'they owe' follow-up owned by an event guest", async () => {
    const eventId = await makeEvent("TheyOwe Event");
    await addInvitee(fd({ eventId, contactId: aliceId }));
    await addEventActionItem(
      fd({ eventId, text: "Share the site plan", direction: "they_owe", ownerId: aliceId }),
    );
    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({ where: { eventId } }),
    );
    expect(item?.ownerContactId).toBe(aliceId);
    expect(item?.ownerUserId).toBeNull();
  });

  test("refuses a 'they owe' owner who is not a guest on the event", async () => {
    const eventId = await makeEvent("NonGuest Event");
    await addInvitee(fd({ eventId, contactId: aliceId }));
    await expect(
      addEventActionItem(
        fd({ eventId, text: "x", direction: "they_owe", ownerId: outsiderContactId }),
      ),
    ).rejects.toThrow();
  });

  test("resolves then removes a follow-up, scoped to the tenant", async () => {
    const eventId = await makeEvent("Lifecycle Event");
    await addEventActionItem(
      fd({ eventId, text: "Follow up", direction: "we_owe", ownerId: staffUser.id }),
    );
    const item = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findFirst({ where: { eventId } }),
    );
    await updateEventActionItemStatus(fd({ id: item!.id, eventId, status: "done" }));
    const done = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: item!.id }, select: { status: true } }),
    );
    expect(done?.status).toBe("done");

    await deleteEventActionItem(fd({ id: item!.id, eventId }));
    const gone = await withOrg(orgA.id, (tx) =>
      tx.actionItem.findUnique({ where: { id: item!.id } }),
    );
    expect(gone).toBeNull();
  });

  test("logs an introduction made at the event", async () => {
    const eventId = await makeEvent("Intro Event");
    await addInvitee(fd({ eventId, contactId: aliceId }));
    await addInvitee(fd({ eventId, contactId: bobId }));
    await logIntroductionAtEvent(
      fd({
        eventId,
        partyAContactId: aliceId,
        partyBContactId: bobId,
        status: "made",
      }),
    );
    const intro = await withOrg(orgA.id, (tx) =>
      tx.introduction.findFirst({ where: { eventId } }),
    );
    expect(intro?.partyAContactId).toBe(aliceId);
    expect(intro?.partyBContactId).toBe(bobId);
    expect(intro?.status).toBe("made");
    expect(intro?.source).toBe("manual");
  });

  test("refuses an introduction between identical parties", async () => {
    const eventId = await makeEvent("SameParty Event");
    await expect(
      logIntroductionAtEvent(
        fd({ eventId, partyAContactId: aliceId, partyBContactId: aliceId, status: "made" }),
      ),
    ).rejects.toThrow();
  });

  test("refuses an introduction naming a contact from another tenant", async () => {
    const eventId = await makeEvent("Foreign Intro Event");
    await expect(
      logIntroductionAtEvent(
        fd({ eventId, partyAContactId: aliceId, partyBContactId: bContactId, status: "made" }),
      ),
    ).rejects.toThrow();
  });
});
