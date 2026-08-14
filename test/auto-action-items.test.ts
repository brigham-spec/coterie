import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Integration test for autoExtractActionItems (automatic on-sync extraction).
// Exercises the persist path against the real Neon DB, mocking only the two
// external seams: the Anthropic call (generateActionItems) and the AI rate limit.
// The load-bearing assertions: only owner-RESOLVED items persist (staff ->
// ownerUserId, contact -> ownerContactId), an unattributed ("unknown") item is
// DROPPED rather than guessed, and a meeting with no usable notes is skipped.

// The mock resolves owners exactly as the real model would after matching names
// against the supplied candidate pools: one staff-owned, one attendee-owned, one
// unattributed. The unknown item must never persist (owner-XOR CHECK).
const generateActionItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/action-items", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/action-items")>()),
  generateActionItems,
}));

vi.mock("@/lib/ai-rate-limit", () => ({
  enforceAiRateLimit: vi.fn(async () => {}),
  AiRateLimitError: class AiRateLimitError extends Error {},
}));

const { autoExtractActionItems } = await import("@/lib/auto-action-items");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

const companyId = randomUUID();
const contactId = randomUUID();
let meetingWithNotesId: string;
let meetingNoNotesId: string;

beforeAll(async () => {
  await prisma.organization.create({ data: { ...orgA, orgType: "edc" } });
  await prisma.user.create({ data: staffUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "staff" },
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: { id: contactId, orgId: orgA.id, companyId, name: "Ada Acme" },
    });

    const withNotes = await tx.meeting.create({
      data: {
        orgId: orgA.id,
        title: "Q3 check-in",
        heldAt: new Date("2026-06-01T15:00:00Z"),
        summary: "Discussed the IDA application and next steps in detail.",
      },
    });
    meetingWithNotesId = withNotes.id;
    // Ada attended, so she is a "they owe" owner candidate for this meeting.
    await tx.meetingAttendee.create({
      data: {
        orgId: orgA.id,
        meetingId: withNotes.id,
        contactId,
        matchMethod: "manual",
        confidence: 1,
        confirmed: true,
      },
    });

    const noNotes = await tx.meeting.create({
      data: {
        orgId: orgA.id,
        title: "Quick sync",
        heldAt: new Date("2026-06-02T15:00:00Z"),
        summary: "hi",
      },
    });
    meetingNoNotesId = noNotes.id;
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgA.id } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function itemsForMeeting(meetingId: string) {
  return withOrg(orgA.id, (tx) =>
    tx.actionItem.findMany({
      where: { meetingId },
      orderBy: { text: "asc" },
      select: { text: true, ownerUserId: true, ownerContactId: true },
    }),
  );
}

describe("autoExtractActionItems", () => {
  test("persists only owner-resolved items and drops the unattributed one", async () => {
    generateActionItems.mockResolvedValueOnce([
      { text: "Send the IDA draft", ownerName: staffUser.name, ownerKind: "staff", ownerId: staffUser.id },
      { text: "Return the signed NDA", ownerName: "Ada Acme", ownerKind: "contact", ownerId: contactId },
      { text: "Someone should follow up", ownerName: "", ownerKind: "unknown", ownerId: null },
    ]);

    const created = await autoExtractActionItems(orgA.id, [meetingWithNotesId]);
    expect(created).toBe(2);

    const rows = await itemsForMeeting(meetingWithNotesId);
    expect(rows).toEqual([
      { text: "Return the signed NDA", ownerUserId: null, ownerContactId: contactId },
      { text: "Send the IDA draft", ownerUserId: staffUser.id, ownerContactId: null },
    ]);
  });

  test("skips a meeting whose notes are too short to extract from", async () => {
    const created = await autoExtractActionItems(orgA.id, [meetingNoNotesId]);
    expect(created).toBe(0);
    // The model is never even called for a summary under the minimum length.
    expect(generateActionItems).not.toHaveBeenCalledWith(
      "hi",
      expect.anything(),
      expect.anything(),
    );
    expect(await itemsForMeeting(meetingNoNotesId)).toEqual([]);
  });

  test("no-ops on an empty meeting list", async () => {
    expect(await autoExtractActionItems(orgA.id, [])).toBe(0);
  });
});
