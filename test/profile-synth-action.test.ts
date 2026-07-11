import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type {
  ProfileSynthesis,
  SynthCompanyContext,
  SynthEvidence,
} from "@/lib/profile-synth";

// Action-level integration test for batch profile synth (gap-audit cluster E).
// Runs against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateProfileSynthesis).
// Proves synthesizeCompany assembles THIS company's own multi-source evidence
// (meetings, event notes, introductions, open/done commitments, articles,
// projects — never another tenant's), declines a member with no evidence, and
// refuses a foreign id; and that applyCompanySynthesis writes only the selected
// fields — merging counties and appending notes with a dated header — into THIS
// tenant, and refuses a foreign company id.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/profile-synth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile-synth")>();
  return { ...actual, generateProfileSynthesis: genSpy };
});

const { synthesizeCompany, applyCompanySynthesis } = await import(
  "@/app/dashboard/companies/synth-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
const counterpartCompanyId = randomUUID();
const counterpartContactId = randomUUID();
const meetingAId = randomUUID();
const eventAId = randomUUID();
const projectAId = randomUUID();
const emptyCompanyId = randomUUID();
const companyBId = randomUUID();

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
        counties: ["Dutchess"],
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

    // A counterpart company + contact so an introduction has a named other side.
    await tx.company.create({
      data: {
        id: counterpartCompanyId,
        orgId: orgA.id,
        name: "Vance Refrigeration",
        status: "member",
        industry: "HVAC",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: {
        id: counterpartContactId,
        orgId: orgA.id,
        companyId: counterpartCompanyId,
        name: "Bob Vance",
        isPrimary: true,
      },
    });

    // Meeting this member attended, with an OPEN and a DONE commitment on it.
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
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        meetingId: meetingAId,
        text: "Shared the site plan",
        status: "done",
        ownerContactId: contactAId,
      },
    });

    // Event-conversation note against this member's contact.
    await tx.event.create({
      data: { id: eventAId, orgId: orgA.id, name: "Spring Mixer", type: "social" },
    });
    await tx.eventInvitee.create({
      data: {
        orgId: orgA.id,
        eventId: eventAId,
        contactId: contactAId,
        rsvp: "attended",
        notes: "Chatted about the Kingston mill expansion.",
      },
    });

    // Introduction this member's contact was party to.
    await tx.introduction.create({
      data: {
        orgId: orgA.id,
        partyAContactId: contactAId,
        partyBContactId: counterpartContactId,
        status: "made",
        source: "manual",
        outcome: "warm handoff",
      },
    });

    // Saved article against this company.
    await tx.newsItem.create({
      data: {
        orgId: orgA.id,
        companyId: companyAId,
        headline: "Acme lands state grant",
        url: "https://example.com/acme-grant",
        summary: "$500k awarded for the mill.",
        capturedAt: new Date("2026-06-05T12:00:00Z"),
      },
    });

    // Active project this member is linked to.
    await tx.project.create({
      data: { id: projectAId, orgId: orgA.id, name: "Kingston Mill", stage: "pre_development" },
    });
    await tx.projectLink.create({
      data: {
        orgId: orgA.id,
        projectId: projectAId,
        companyId: companyAId,
        role: "developer",
      },
    });

    // A member with no evidence at all — synth must report empty.
    await tx.company.create({
      data: {
        id: emptyCompanyId,
        orgId: orgA.id,
        name: "No Evidence Co",
        status: "member",
        industry: "Retail",
        annualValue: 1000,
      },
    });
  });

  // Org B: its own company — must stay invisible / refused.
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

describe("synthesizeCompany", () => {
  test("assembles this company's own multi-source evidence for the model", async () => {
    const synthesis: ProfileSynthesis = {
      summary: "Scaling manufacturer.",
      lookingFor: "growth capital",
      canOffer: "manufacturing capacity",
      counties: "Orange",
      agencyContacts: "Ulster County IDA",
      dealSize: "$2-5M",
      notesAppend: "per [2026-06-01] meeting: board approved a Series B.",
    };
    genSpy.mockResolvedValue(synthesis);

    const result = await synthesizeCompany(companyAId);
    expect(result).toEqual({ status: "ok", synthesis });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as SynthCompanyContext;
    const evidence = genSpy.mock.calls[0][1] as SynthEvidence;

    expect(context.name).toBe("Acme Mills");
    expect(context.contactName).toBe("Jane Doe");
    expect(context.industry).toBe("Manufacturing");
    expect(context.counties).toEqual(["Dutchess"]);

    // Every evidence source is this company's own.
    expect(evidence.meetings.map((m) => m.title)).toEqual(["Q3 check-in"]);
    expect(evidence.meetings[0].date).toBe("2026-06-01");
    expect(evidence.openItems).toEqual(["Send the IDA draft"]);
    expect(evidence.doneItems).toEqual(["Shared the site plan"]);
    expect(evidence.eventNotes).toEqual([
      "Spring Mixer: Chatted about the Kingston mill expansion.",
    ]);
    // The intro's counterpart (the other party) is named, not this member.
    expect(evidence.intros).toEqual(["Intro to Bob Vance → warm handoff"]);
    expect(evidence.articles).toEqual([
      "Acme lands state grant — $500k awarded for the mill.",
    ]);
    expect(evidence.projects).toEqual(["Kingston Mill (Pre-Development)"]);
  });

  test("reports empty when the member has no evidence", async () => {
    const result = await synthesizeCompany(emptyCompanyId);
    expect(result).toEqual({ status: "empty" });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("reports empty when the model returns nothing usable", async () => {
    genSpy.mockResolvedValue(null);
    const result = await synthesizeCompany(companyAId);
    expect(result).toEqual({ status: "empty" });
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const result = await synthesizeCompany(companyBId);
    expect(result).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("applyCompanySynthesis", () => {
  test("writes selected fields, merges counties, and appends dated notes", async () => {
    const result = await applyCompanySynthesis(companyAId, {
      lookingFor: "growth capital",
      counties: "Dutchess, Orange, Greene",
      dealSize: "$2-5M",
      notesAppend: "Board approved a Series B.",
    });
    expect(result).toEqual({ status: "applied", count: 4 });

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          lookingFor: true,
          canOffer: true,
          counties: true,
          dealSize: true,
          notes: true,
        },
      }),
    );
    expect(company!.lookingFor).toBe("growth capital");
    // canOffer was NOT selected → left untouched (null).
    expect(company!.canOffer).toBeNull();
    expect(company!.dealSize).toBe("$2-5M");
    // Existing Dutchess kept, only genuinely new counties appended (no dupes).
    expect(company!.counties).toEqual(["Dutchess", "Orange", "Greene"]);
    // Original note preserved; the append carries a dated "[Synthesized]" header.
    expect(company!.notes).toContain("Existing note.");
    expect(company!.notes).toContain("Board approved a Series B.");
    expect(company!.notes).toMatch(/\[Synthesized, \d{4}-\d{2}-\d{2}\]:/);
  });

  test("rejects an empty selection", async () => {
    const result = await applyCompanySynthesis(companyAId, {});
    expect(result).toEqual({ status: "error", message: "Nothing selected to apply." });
  });

  test("refuses to write to another tenant's company (RLS → not found)", async () => {
    const result = await applyCompanySynthesis(companyBId, { lookingFor: "leaked" });
    expect(result).toEqual({
      status: "error",
      message: "company not found in this organization",
    });

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({ where: { id: companyBId }, select: { lookingFor: true } }),
    );
    expect(companyB!.lookingFor).toBeNull();
  });
});
