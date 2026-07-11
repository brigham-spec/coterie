import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type {
  EnrichCompanyContext,
  EnrichMeeting,
  ProfileEnrichment,
} from "@/lib/enrich-meetings";

// Action-level integration test for enrich-from-meetings (gap-audit cluster E).
// Runs against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateProfileEnrichment).
// Proves the enrich action grounds the model in THIS company's own meetings +
// action items (never another tenant's), and that applyMeetingEnrichment writes
// only the selected fields — appending notes with a dated header — into THIS
// tenant, and refuses a foreign company id.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/enrich-meetings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/enrich-meetings")>();
  return { ...actual, generateProfileEnrichment: genSpy };
});

const { enrichFromMeetingsAction, applyMeetingEnrichment } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
const meetingAId = randomUUID();
const emptyCompanyId = randomUUID();
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

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
        notes: "Existing note.",
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Jane Doe",
        isPrimary: true,
      },
    });
    await tx.meeting.create({
      data: {
        id: meetingAId,
        orgId: orgA.id,
        title: "Q3 check-in",
        heldAt: new Date("2026-06-01T15:00:00Z"),
        summary: "Discussed the IDA application and a Series B raise.",
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
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        text: "Send the IDA draft",
        status: "open",
        ownerContactId: contactAId,
      },
    });
    // A member with no synced meetings — enrich must decline gracefully.
    await tx.company.create({
      data: {
        id: emptyCompanyId,
        orgId: orgA.id,
        name: "No Meetings Co",
        status: "member",
        industry: "Retail",
        annualValue: 1000,
      },
    });
  });

  // Org B: its own company + contact + meeting — must stay invisible.
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
        name: "Other Person",
        isPrimary: true,
      },
    });
    await tx.meeting.create({
      data: {
        id: meetingBId,
        orgId: orgB.id,
        title: "Foreign meeting",
        heldAt: new Date("2026-06-02T15:00:00Z"),
        summary: "Foreign summary.",
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
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
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

describe("enrichFromMeetingsAction", () => {
  test("grounds the model in this company's own meetings + action items", async () => {
    const enrichment: ProfileEnrichment = {
      summary: "They need capital.",
      lookingFor: "growth capital",
      canOffer: "manufacturing capacity",
      industry: "Advanced Manufacturing",
      notesAppend: "Board approved a Series B.",
    };
    genSpy.mockResolvedValue(enrichment);

    const state = await enrichFromMeetingsAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({ status: "ok", enrichment });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as EnrichCompanyContext;
    const meetings = genSpy.mock.calls[0][1] as EnrichMeeting[];

    expect(context.orgName).toBe("Acme Mills");
    expect(context.contactName).toBe("Jane Doe");
    expect(context.industry).toBe("Manufacturing");

    // Only this company's meeting, with its action item folded on; org B absent.
    expect(meetings.map((m) => m.title)).toEqual(["Q3 check-in"]);
    expect(meetings[0].date).toBe("2026-06-01");
    expect(meetings[0].actionItems).toEqual(["Send the IDA draft"]);
    expect(meetings.map((m) => m.title)).not.toContain("Foreign meeting");
  });

  test("declines gracefully when the member has no synced meetings", async () => {
    const state = await enrichFromMeetingsAction(
      { status: "idle" },
      fd({ companyId: emptyCompanyId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "No synced meetings found for this member yet.",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an empty parse as a 'nothing new' error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await enrichFromMeetingsAction(
      { status: "idle" },
      fd({ companyId: companyAId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "No new profile details found in recent meetings.",
    });
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await enrichFromMeetingsAction(
      { status: "idle" },
      fd({ companyId: companyBId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("applyMeetingEnrichment", () => {
  test("writes only the selected fields and appends notes with a dated header", async () => {
    const selection = {
      lookingFor: "growth capital",
      industry: "Advanced Manufacturing",
      notesAppend: "Board approved a Series B.",
    };
    const state = await applyMeetingEnrichment(
      { status: "idle" },
      fd({ companyId: companyAId, enrichment: JSON.stringify(selection) }),
    );
    expect(state).toEqual({ status: "applied", count: 3 });

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { lookingFor: true, canOffer: true, industry: true, notes: true },
      }),
    );
    expect(company!.lookingFor).toBe("growth capital");
    expect(company!.industry).toBe("Advanced Manufacturing");
    // canOffer was NOT selected → left untouched (null).
    expect(company!.canOffer).toBeNull();
    // The original note is preserved and the append carries a dated header.
    expect(company!.notes).toContain("Existing note.");
    expect(company!.notes).toContain("Board approved a Series B.");
    expect(company!.notes).toMatch(/\[Meetings, \d{4}-\d{2}-\d{2}\]:/);
  });

  test("rejects an empty selection", async () => {
    const state = await applyMeetingEnrichment(
      { status: "idle" },
      fd({ companyId: companyAId, enrichment: JSON.stringify({}) }),
    );
    expect(state).toEqual({ status: "error", message: "Nothing selected to apply." });
  });

  test("refuses to write to another tenant's company (RLS → not found)", async () => {
    const state = await applyMeetingEnrichment(
      { status: "idle" },
      fd({
        companyId: companyBId,
        enrichment: JSON.stringify({ lookingFor: "leaked" }),
      }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({ where: { id: companyBId }, select: { lookingFor: true } }),
    );
    expect(companyB!.lookingFor).toBeNull();
  });
});
