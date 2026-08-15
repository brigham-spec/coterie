import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { MeetingPrepBrief, MeetingPrepInput } from "@/lib/meeting-prep";

// Action-level integration test for the pre-meeting brief (gap-audit cluster A).
// Exercises generateMeetingPrepAction against the real Neon DB, mocking only the
// two external seams: Clerk (requireOrgContext) and the Anthropic engine. The
// load-bearing assertion inspects the input the action assembled for the model —
// proving it is grounded in THIS company's own contacts, meetings, OPEN
// commitments, recent news, the value snapshot, and a candidate pool — and never
// another tenant's rows. It also checks the returned brief + verbatim fact
// sections carry back through the server-action boundary.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/meeting-prep", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meeting-prep")>();
  return { ...actual, generateMeetingPrep: genSpy };
});

const { generateMeetingPrepAction } = await import(
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
const contactAId = randomUUID();
const meetingAId = randomUUID();
const candidateAId = randomUUID();
const companyBId = randomUUID();
const contactBId = randomUUID();
const meetingBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: staffUser });

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
      data: { id: contactAId, orgId: orgA.id, companyId: companyAId, name: "Jane Doe" },
    });
    await tx.meeting.create({
      data: {
        id: meetingAId,
        orgId: orgA.id,
        title: "Q3 check-in",
        heldAt: new Date("2026-06-01T15:00:00Z"),
        summary: "Discussed the IDA application.",
      },
    });
    await tx.meetingAttendee.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        contactId: contactAId,
        matchMethod: "manual",
        confidence: 1,
        confirmed: true,
      },
    });
    // Open commitment we owe (staff-owned) + open commitment they owe (contact).
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        text: "Send the IDA draft",
        status: "open",
        ownerUserId: staffUser.id,
      },
    });
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        text: "Share their board deck",
        status: "open",
        ownerContactId: contactAId,
      },
    });
    // A DONE item on the same meeting must NOT surface.
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        text: "Closed already",
        status: "done",
        ownerContactId: contactAId,
      },
    });

    // Recent coverage on this company — folds into the news section + prompt.
    await tx.newsItem.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        headline: "Acme breaks ground in Kingston",
        url: "https://example.com/acme",
        capturedAt: new Date("2026-06-20T00:00:00Z"),
      },
    });

    // A monetary win on the ledger — drives the value snapshot.
    await tx.valueDelivered.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        kind: "service",
        amount: 125000,
        summary: "Warehouse siting help",
        outcome: "Signed a lease",
        occurredAt: new Date("2026-05-01T00:00:00Z"),
      },
    });

    // A separate network company — a valid intro candidate (not the focus, never
    // introduced to it) that must appear in the model's candidate pool.
    await tx.company.create({
      data: {
        id: candidateAId,
        orgId: orgA.id,
        name: "Riverside Capital",
        status: "member",
        industry: "Finance",
        lookingFor: "manufacturing deals",
        canOffer: "growth capital",
        annualValue: 1000,
      },
    });
  });

  // Org B: its own company + contact + meeting + open item — must stay invisible.
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
      data: { id: contactBId, orgId: orgB.id, companyId: companyBId, name: "Other Person" },
    });
    await tx.meeting.create({
      data: {
        id: meetingBId,
        orgId: orgB.id,
        title: "Foreign meeting",
        heldAt: new Date("2026-06-02T15:00:00Z"),
      },
    });
    await tx.meetingAttendee.create({
      data: {
        orgId: orgB.id,
        meetingId: meetingBId,
        contactId: contactBId,
        matchMethod: "manual",
        confidence: 1,
      },
    });
    await tx.actionItem.create({
      data: {
        orgId: orgB.id,
        meetingId: meetingBId,
        text: "Foreign commitment",
        status: "open",
        ownerContactId: contactBId,
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.userName = "Alex";
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BRIEF: MeetingPrepBrief = {
  narrative: "Pick up where the IDA application left off.",
  introRecommendations: [
    { companyId: candidateAId, companyName: "Riverside Capital", reason: "capital fit" },
  ],
};

describe("generateMeetingPrepAction", () => {
  test("assembles this company's own grounded context for the model", async () => {
    genSpy.mockResolvedValue(BRIEF);

    const state = await generateMeetingPrepAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    if (state.status !== "ok") throw new Error(`expected ok, got ${state.status}`);

    // The brief comes back verbatim; the verbatim fact sections are assembled
    // from the DB (never the model), and stay serializable across the boundary.
    expect(state.brief).toEqual(BRIEF);
    expect(state.sections.lastMeeting).toEqual({
      title: "Q3 check-in",
      heldAt: "2026-06-01",
    });
    expect(state.sections.actionItems.map((a) => a.text)).toEqual(
      expect.arrayContaining(["Send the IDA draft", "Share their board deck"]),
    );
    expect(state.sections.news).toEqual([
      {
        headline: "Acme breaks ground in Kingston",
        url: "https://example.com/acme",
        capturedAt: "2026-06-20",
      },
    ]);
    expect(state.sections.value).toEqual({
      totalAmount: 125000,
      entryCount: 1,
      monetaryCount: 1,
    });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const input = genSpy.mock.calls[0][0] as MeetingPrepInput;

    expect(input.userName).toBe("Alex");
    expect(input.company.name).toBe("Acme Mills");
    expect(input.company.contacts.map((c) => c.name)).toEqual(["Jane Doe"]);

    // The meeting this company's contact attended is present; org B's is not.
    expect(input.recentMeetings.map((m) => m.title)).toEqual(["Q3 check-in"]);
    expect(input.recentMeetings[0].heldAt).toBe("2026-06-01");

    // Only OPEN commitments, correctly sided; the done item and org B's are absent.
    const texts = input.openCommitments.map((c) => c.text);
    expect(texts).toContain("Send the IDA draft");
    expect(texts).toContain("Share their board deck");
    expect(texts).not.toContain("Closed already");
    expect(texts).not.toContain("Foreign commitment");
    expect(
      input.openCommitments.find((c) => c.text === "Send the IDA draft")?.owedBy,
    ).toBe("us");
    expect(
      input.openCommitments.find((c) => c.text === "Share their board deck")?.owedBy,
    ).toBe("them");

    // Recent news + value snapshot fed to the model.
    expect(input.recentNews.map((n) => n.headline)).toEqual([
      "Acme breaks ground in Kingston",
    ]);
    expect(input.valueSnapshot).toEqual({
      totalAmount: 125000,
      entryCount: 1,
      monetaryCount: 1,
    });

    // The candidate pool is this org's other network companies — the focus is
    // excluded, and org B's company never leaks in.
    const candidateIds = input.candidates.map((c) => c.id);
    expect(candidateIds).toContain(candidateAId);
    expect(candidateIds).not.toContain(companyAId);
    expect(candidateIds).not.toContain(companyBId);
    const riverside = input.candidates.find((c) => c.id === candidateAId);
    expect(riverside?.lookingFor).toBe("manufacturing deals");
    expect(riverside?.canOffer).toBe("growth capital");
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await generateMeetingPrepAction(
      { status: "idle" },
      fd({ companyId: companyBId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await generateMeetingPrepAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not prepare a brief. Try again.",
    });
  });
});
