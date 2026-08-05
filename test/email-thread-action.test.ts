import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type {
  EmailThreadContext,
  EmailThreadExtraction,
} from "@/lib/extract-email-thread";

// Action-level integration test for the org-level paste-a-thread flow (Email
// items 8 + 10). Runs against the real Neon DB, mocking only two external seams:
// Clerk (requireOrgContext) and the Anthropic engine (generateEmailThreadExtraction).
// Proves extractEmailThread grounds the model in THIS org's members and returns the
// deterministic sender match; saveEmailThread lands a Meeting attributed to the
// matched company (or a freshly-created prospect for an unmatched sender), folds
// action items + insights into the summary, creates the surfaced prospects deduped,
// and never sees another tenant's data.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/extract-email-thread", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extract-email-thread")>();
  return { ...actual, generateEmailThreadExtraction: genSpy };
});

vi.mock("@/lib/ai-rate-limit", () => ({
  AiRateLimitError: class AiRateLimitError extends Error {},
  enforceAiRateLimit: vi.fn(async () => {}),
}));

const { extractEmailThread, saveEmailThread } = await import(
  "@/app/dashboard/email/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
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
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Jane Doe",
        email: "jane@acmemills.example",
        isPrimary: true,
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

const matched: EmailThreadExtraction = {
  primaryContact: {
    name: "Jane Doe",
    org: "Acme Mills",
    email: "jane@acmemills.example",
    title: "COO",
  },
  meetingTitle: "Kingston site tour follow-up",
  meetingDate: "2026-06-30",
  summary: "They confirmed the tour and asked for the PILOT term sheet.",
  actionItems: "Send PILOT term sheet; schedule the site tour",
  keyInsights: "Weighing two other counties.",
  newProspects: [
    { name: "Sam Lee", org: "Riverside Logistics", email: "sam@riverside.example", notes: "Warehouse." },
  ],
};

describe("extractEmailThread", () => {
  test("grounds the model in this org's members and returns the sender match", async () => {
    genSpy.mockResolvedValue(matched);

    const state = await extractEmailThread(
      { status: "idle" },
      fd({ thread: "From: jane@acmemills.example\nHi" }),
    );
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.extraction).toEqual(matched);
    expect(state.matchedCompany).toEqual({ id: companyAId, name: "Acme Mills" });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as EmailThreadContext;
    expect(context.orgName).toBe(orgA.name);
    expect(context.memberOrgs).toContain("Acme Mills");
  });

  test("rejects an empty thread before calling the model", async () => {
    const state = await extractEmailThread({ status: "idle" }, fd({ thread: "   " }));
    expect(state).toEqual({ status: "error", message: "Paste an email thread first." });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an unreadable thread as a 'could not read' error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await extractEmailThread(
      { status: "idle" },
      fd({ thread: "garbled" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not read that email thread.",
    });
  });

  test("returns no match for an unknown sender", async () => {
    genSpy.mockResolvedValue({
      ...matched,
      primaryContact: { name: "Pat Quinn", org: "Zephyr Freight", email: "pat@zephyr.example", title: "" },
    });
    const state = await extractEmailThread(
      { status: "idle" },
      fd({ thread: "From: pat@zephyr.example\nHi" }),
    );
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.matchedCompany).toBeNull();
  });
});

describe("saveEmailThread", () => {
  test("lands a meeting on the matched company and creates the surfaced prospect", async () => {
    const state = await saveEmailThread(
      { status: "idle" },
      fd({ extraction: JSON.stringify(matched) }),
    );
    expect(state).toEqual({
      status: "saved",
      companyId: companyAId,
      savedSummary: matched.summary,
    });

    const { meetings, riverside } = await withOrg(orgA.id, async (tx) => {
      const meetings = await tx.meeting.findMany({
        where: { attendees: { some: { contactId: contactAId } } },
        include: { attendees: true },
      });
      const riverside = await tx.company.findFirst({
        where: { name: "Riverside Logistics" },
        include: { contacts: true },
      });
      return { meetings, riverside };
    });

    expect(meetings).toHaveLength(1);
    const meeting = meetings[0];
    expect(meeting.title).toBe("Kingston site tour follow-up");
    // Action items + key insights fold into the summary.
    expect(meeting.summary).toContain("Send PILOT term sheet");
    expect(meeting.summary).toContain("Key insights: Weighing two other counties.");
    // The attendee is the company's primary contact, confirmed + manual.
    expect(meeting.attendees).toHaveLength(1);
    expect(meeting.attendees[0].contactId).toBe(contactAId);
    expect(meeting.attendees[0].matchMethod).toBe("manual");

    // The surfaced prospect became a prospect company with a contact.
    expect(riverside).not.toBeNull();
    expect(riverside!.status).toBe("prospect");
    expect(riverside!.contacts[0].name).toBe("Sam Lee");
  });

  test("creates a prospect from an unmatched sender and attaches the meeting to it", async () => {
    const unmatched: EmailThreadExtraction = {
      primaryContact: {
        name: "Dana West",
        org: "Highland Ventures",
        email: "dana@highland.example",
        title: "Partner",
      },
      meetingTitle: "Intro call",
      meetingDate: "",
      summary: "Exploring a fund partnership.",
      actionItems: "",
      keyInsights: "",
      newProspects: [],
    };

    const state = await saveEmailThread(
      { status: "idle" },
      fd({ extraction: JSON.stringify(unmatched) }),
    );
    expect(state.status).toBe("saved");
    if (state.status !== "saved") return;

    const created = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: state.companyId },
        include: { contacts: true },
      }),
    );
    expect(created).not.toBeNull();
    expect(created!.name).toBe("Highland Ventures");
    expect(created!.status).toBe("prospect");
    expect(created!.source).toBe("Email thread");
    expect(created!.contacts).toHaveLength(1);
    expect(created!.contacts[0].name).toBe("Dana West");
    expect(created!.contacts[0].isPrimary).toBe(true);

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { attendees: { some: { contactId: created!.contacts[0].id } } },
      }),
    );
    expect(meeting?.title).toBe("Intro call");
  });

  test("dedupes a surfaced prospect against an existing company (case-insensitive)", async () => {
    const dupe: EmailThreadExtraction = {
      ...matched,
      meetingTitle: "Second touch",
      newProspects: [
        { name: "Someone", org: "ACME MILLS", email: "", notes: "dup of member" },
      ],
    };
    await saveEmailThread({ status: "idle" }, fd({ extraction: JSON.stringify(dupe) }));

    const acmes = await withOrg(orgA.id, (tx) =>
      tx.company.findMany({ where: { name: { equals: "Acme Mills", mode: "insensitive" } } }),
    );
    // No second "Acme Mills" was created.
    expect(acmes).toHaveLength(1);
  });

  test("rejects an extraction that carries no usable content", async () => {
    const state = await saveEmailThread(
      { status: "idle" },
      fd({ extraction: JSON.stringify({ summary: "", meetingTitle: "" }) }),
    );
    expect(state).toEqual({ status: "error", message: "Nothing to save." });
  });
});
