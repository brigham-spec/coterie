import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { ParsedCapture } from "@/lib/quick-capture";

// Action-level integration test for the quick-capture helper (gap-audit cluster
// E). Runs against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateQuickCapture). Proves
// the parse action resolves matched ids to THIS tenant's contacts only, and the
// save action writes a meeting (with attendees + folded follow-ups) plus new
// prospects into THIS tenant — and only this tenant.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quick-capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quick-capture")>();
  return { ...actual, generateQuickCapture: genSpy };
});

const { parseQuickCaptureAction, saveQuickCapture } = await import(
  "@/app/dashboard/quick-capture-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyA = { id: randomUUID(), name: `Bethel Woods ${randomUUID()}` };
const contactA = { id: randomUUID(), name: "Sarah Reed" };
// A foreign contact in orgB, to prove matched ids are re-verified per tenant.
const companyB = { id: randomUUID(), name: `Foreign Co ${randomUUID()}` };
const contactB = { id: randomUUID(), name: "Foreign Contact" };

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
        id: companyA.id,
        orgId: orgA.id,
        name: companyA.name,
        status: "member",
        industry: "Arts",
        annualValue: "0",
        contacts: {
          create: { id: contactA.id, orgId: orgA.id, name: contactA.name, isPrimary: true },
        },
      },
    });
  });
  await withOrg(orgB.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyB.id,
        orgId: orgB.id,
        name: companyB.name,
        status: "member",
        industry: "Other",
        annualValue: "0",
        contacts: {
          create: { id: contactB.id, orgId: orgB.id, name: contactB.name, isPrimary: true },
        },
      },
    });
  });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userName = "Brigham Farrand";
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

describe("parseQuickCaptureAction", () => {
  test("rejects an empty note before any engine call", async () => {
    const state = await parseQuickCaptureAction({ status: "idle" }, fd({ note: "  " }));
    expect(state).toEqual({ status: "error", message: "Describe what happened first." });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("resolves matched ids to this tenant's contacts, dropping foreign ids", async () => {
    const parsed: ParsedCapture = {
      matchedContactIds: [contactA.id, contactB.id, randomUUID()],
      title: "Coffee",
      date: "2026-07-08",
      summary: "Talked shop.",
      actionItems: ["Follow up"],
      suggestedIntros: [],
      newProspects: [],
    };
    genSpy.mockResolvedValue(parsed);

    const state = await parseQuickCaptureAction(
      { status: "idle" },
      fd({ note: "Had coffee with Sarah." }),
    );
    expect(state.status).toBe("ok");
    if (state.status !== "ok") throw new Error("expected ok");
    // Only the orgA contact survives; the orgB contact + the unknown id are dropped.
    expect(state.review.matched).toEqual([
      { id: contactA.id, name: contactA.name, org: companyA.name },
    ]);
    expect(genSpy).toHaveBeenCalledTimes(1);
  });

  test("surfaces an unusable parse as an error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await parseQuickCaptureAction(
      { status: "idle" },
      fd({ note: "gibberish" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Nothing to capture from that note. Try adding more detail.",
    });
  });
});

describe("saveQuickCapture", () => {
  test("writes a meeting with attendees + folded follow-ups and a new prospect", async () => {
    const prospectOrg = `Catskill Legal ${randomUUID()}`;
    const capture = {
      title: "Coffee with Sarah",
      date: "2026-07-08",
      summary: "She needs a land use attorney.",
      actionItems: ["Follow up next Tuesday", "Send the zoning memo"],
      suggestedIntros: [{ toOrg: "ignored", reason: "not persisted" }],
      newProspects: [{ name: "Drew Lang", org: prospectOrg, notes: "land use counsel" }],
      matched: [{ id: contactA.id, name: contactA.name, org: companyA.name }],
    };

    const state = await saveQuickCapture(
      { status: "idle" },
      fd({ capture: JSON.stringify(capture) }),
    );
    expect(state).toEqual({ status: "saved", meeting: true, attendees: 1, prospects: 1 });

    // The meeting exists in orgA with the follow-ups folded into the summary.
    const meetings = await withOrg(orgA.id, (tx) =>
      tx.meeting.findMany({
        where: { title: "Coffee with Sarah" },
        include: { attendees: true },
      }),
    );
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0];
    expect(meeting.summary).toContain("She needs a land use attorney.");
    expect(meeting.summary).toContain("Follow-ups:");
    expect(meeting.summary).toContain("- Follow up next Tuesday");
    expect(meeting.attendees).toHaveLength(1);
    expect(meeting.attendees[0]).toMatchObject({
      contactId: contactA.id,
      matchMethod: "manual",
      confirmed: true,
    });

    // The touched company's last-contact clock was freshened.
    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({ where: { id: companyA.id }, select: { lastContactAt: true } }),
    );
    expect(company!.lastContactAt).not.toBeNull();

    // The new prospect was created in orgA with a primary contact.
    const prospect = await withOrg(orgA.id, (tx) =>
      tx.company.findFirst({
        where: { name: { equals: prospectOrg, mode: "insensitive" } },
        include: { contacts: true },
      }),
    );
    expect(prospect).not.toBeNull();
    expect(prospect!.status).toBe("prospect");
    expect(prospect!.source).toBe("Quick Capture");
    expect(prospect!.contacts).toHaveLength(1);
    expect(prospect!.contacts[0]).toMatchObject({ name: "Drew Lang", isPrimary: true });

    // Nothing leaked into orgB.
    const fromB = await withOrg(orgB.id, (tx) =>
      tx.meeting.findFirst({ where: { title: "Coffee with Sarah" } }),
    );
    expect(fromB).toBeNull();
  });

  test("dedupes a new prospect against an existing company of the same name", async () => {
    const capture = {
      title: "",
      date: "2026-07-08",
      summary: "",
      actionItems: [],
      suggestedIntros: [],
      newProspects: [
        { name: "Someone", org: companyA.name.toUpperCase(), notes: "dupe" },
      ],
      matched: [],
    };

    const state = await saveQuickCapture(
      { status: "idle" },
      fd({ capture: JSON.stringify(capture) }),
    );
    // No meeting (nothing to record), and the prospect deduped away → 0 created.
    expect(state).toEqual({ status: "saved", meeting: false, attendees: 0, prospects: 0 });

    const companies = await withOrg(orgA.id, (tx) =>
      tx.company.findMany({
        where: { name: { equals: companyA.name, mode: "insensitive" } },
      }),
    );
    expect(companies).toHaveLength(1);
  });

  test("refuses to save when the payload is unreadable", async () => {
    const state = await saveQuickCapture({ status: "idle" }, fd({ capture: "not json" }));
    expect(state).toEqual({ status: "error", message: "Nothing to save." });
  });
});
