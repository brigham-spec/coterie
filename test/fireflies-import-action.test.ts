import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { FirefliesTranscript } from "@/lib/fireflies";

// Action-level integration test for the profile "paste a Fireflies ID" import
// (Members audit item 7): importFirefliesTranscript + the shared reconcile it
// runs (src/lib/fireflies-reconcile.ts). Runs against the real Neon DB, mocking
// only Clerk (requireOrgContext), Next's revalidatePath, and the two external
// boundaries — the Fireflies transport (getTranscript) and the encrypted
// credential read (getCredential). Proves a fetched transcript becomes a Meeting
// upserted on fireflies_id (idempotent), that an attendee matched by email links
// as a confirmed attendee and the import reports it surfaces here, that a
// transcript with no attendee on this company reports so instead of implying a
// match, that a share URL is parsed down to its id, and — the cardinal rule —
// that reconcile matches only THIS org's contacts, so a foreign-tenant email
// cannot link across the silo.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const mockGetTranscript = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fireflies", () => ({
  getTranscript: mockGetTranscript,
}));

const mockGetCredential = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations", () => ({
  getCredential: mockGetCredential,
}));

const { importFirefliesTranscript } = await import(
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
const contactA1Email = `ada_${randomUUID()}@acme.example`;

const companyBId = randomUUID();
const contactBId = randomUUID();
const contactBEmail = `bob_${randomUUID()}@beta.example`;

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
    await tx.contact.create({
      data: {
        id: contactA1Id,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Ada Acme",
        email: contactA1Email,
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
    await tx.contact.create({
      data: {
        id: contactBId,
        orgId: orgB.id,
        companyId: companyBId,
        name: "Bob Beta",
        email: contactBEmail,
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
  mockGetCredential.mockResolvedValue({
    accessToken: "tok",
    refreshToken: null,
    scopes: [],
    expiresAt: null,
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function transcript(overrides: Partial<FirefliesTranscript>): FirefliesTranscript {
  return {
    id: randomUUID(),
    title: "Quarterly check-in",
    date: Date.UTC(2026, 7, 1),
    transcript_url: null,
    summary: { overview: "Good conversation.", action_items: null },
    meeting_attendees: [],
    ...overrides,
  };
}

describe("importFirefliesTranscript", () => {
  test("imports a transcript and links an email-matched attendee on this company", async () => {
    const t = transcript({
      title: "Ada sync",
      meeting_attendees: [
        { displayName: "Ada Acme", email: contactA1Email, name: null },
      ],
    });
    mockGetTranscript.mockResolvedValueOnce(t);

    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: t.id }),
    );
    expect(result).toEqual({
      status: "saved",
      message: "Meeting imported from Fireflies.",
    });

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { firefliesId: t.id },
        select: {
          title: true,
          summary: true,
          attendees: { select: { contactId: true, matchMethod: true, confirmed: true } },
        },
      }),
    );
    expect(meeting?.title).toBe("Ada sync");
    expect(meeting?.summary).toBe("Good conversation.");
    expect(meeting?.attendees).toHaveLength(1);
    expect(meeting?.attendees[0]).toMatchObject({
      contactId: contactA1Id,
      matchMethod: "email",
      confirmed: true,
    });
  });

  test("reports when no attendee resolves to a contact on this company", async () => {
    const t = transcript({
      meeting_attendees: [
        { displayName: "Zed Nomatch", email: `zed_${randomUUID()}@gmail.com`, name: null },
      ],
    });
    mockGetTranscript.mockResolvedValueOnce(t);

    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: t.id }),
    );
    expect(result).toEqual({
      status: "saved",
      message: "Imported, but no attendee matched a contact on this company yet.",
    });

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { firefliesId: t.id },
        select: { attendees: { select: { contactId: true } } },
      }),
    );
    expect(meeting?.attendees).toHaveLength(0);
  });

  test("is idempotent — re-importing the same id upserts one meeting", async () => {
    const t = transcript({
      meeting_attendees: [{ displayName: "Ada Acme", email: contactA1Email, name: null }],
    });
    mockGetTranscript.mockResolvedValue(t);

    await importFirefliesTranscript(fd({ companyId: companyAId, transcriptId: t.id }));
    await importFirefliesTranscript(fd({ companyId: companyAId, transcriptId: t.id }));
    mockGetTranscript.mockReset();

    const count = await withOrg(orgA.id, (tx) =>
      tx.meeting.count({ where: { firefliesId: t.id } }),
    );
    expect(count).toBe(1);
  });

  test("parses a Fireflies share URL down to the transcript id", async () => {
    const id = randomUUID();
    mockGetTranscript.mockResolvedValueOnce(transcript({ id }));

    await importFirefliesTranscript(
      fd({
        companyId: companyAId,
        transcriptId: `https://app.fireflies.ai/view/Quarterly-Check-in::${id}`,
      }),
    );
    expect(mockGetTranscript.mock.lastCall?.[1]).toBe(id);
  });

  test("errors when Fireflies has no transcript with that id", async () => {
    mockGetTranscript.mockResolvedValueOnce(null);
    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: "does-not-exist" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "No Fireflies transcript with that ID.",
    });
  });

  test("errors when the org has not connected Fireflies", async () => {
    mockGetCredential.mockResolvedValueOnce(null);
    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: "anything" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Connect Fireflies on the Meetings page first.",
    });
  });

  test("requires a transcript id", async () => {
    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: "   " }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Paste a Fireflies transcript ID or link.",
    });
  });

  test("cannot link a contact from another tenant (reconcile is org-scoped)", async () => {
    const t = transcript({
      meeting_attendees: [{ displayName: "Bob Beta", email: contactBEmail, name: null }],
    });
    mockGetTranscript.mockResolvedValueOnce(t);

    const result = await importFirefliesTranscript(
      fd({ companyId: companyAId, transcriptId: t.id }),
    );
    // The meeting imports under orgA, but Bob (orgB) is invisible to reconcile —
    // he must not be linked, and no orgB attendee row may appear for this meeting.
    expect(result.status).toBe("saved");
    const linkedToB = await withOrg(orgB.id, (tx) =>
      tx.meetingAttendee.count({ where: { contactId: contactBId } }),
    );
    expect(linkedToB).toBe(0);
  });
});
