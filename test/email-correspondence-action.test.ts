import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { EmailExtractionContext, EmailExtraction } from "@/lib/extract-email";

// Action-level integration test for email correspondence (member-profile parity).
// Runs against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateEmailExtraction). Proves
// the extract action grounds the model in THIS company's own name + contacts
// (never another tenant's), that saveEmailMessage lands a manual EmailMessage row
// scoped to THIS tenant (keyed manual:…), and that both writes refuse a foreign
// company id. deleteEmailCorrespondence drops a row RLS-scoped.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/extract-email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extract-email")>();
  return { ...actual, generateEmailExtraction: genSpy };
});

const {
  extractEmailThreadAction,
  saveEmailMessage,
  deleteEmailCorrespondence,
} = await import("@/app/dashboard/companies/[id]/actions");

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
        isPrimary: true,
      },
    });
  });

  // Org B: its own company — must stay invisible to org A's actions.
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

const sample: EmailExtraction = {
  subject: "Kingston site tour follow-up",
  summary: "They confirmed the tour and asked for the PILOT term sheet.",
  projects: "Kingston Mill Redevelopment",
  actionItems: "Send PILOT term sheet; schedule the site tour",
  sentiment: "positive",
  emailDate: "2026-06-30",
  fromName: "Jane Doe",
  fromEmail: "jane@acmemills.example",
};

describe("extractEmailThreadAction", () => {
  test("grounds the model in this company's own name and contacts", async () => {
    genSpy.mockResolvedValue(sample);

    const state = await extractEmailThreadAction(
      { status: "idle" },
      fd({ companyId: companyAId, thread: "From: jane@acmemills.example\nHi" }),
    );
    expect(state).toEqual({ status: "ok", extraction: sample });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as EmailExtractionContext;
    expect(context.orgName).toBe("Acme Mills");
    expect(context.contactNames).toEqual(["Jane Doe"]);
  });

  test("rejects an empty thread before calling the model", async () => {
    const state = await extractEmailThreadAction(
      { status: "idle" },
      fd({ companyId: companyAId, thread: "   " }),
    );
    expect(state).toEqual({ status: "error", message: "Paste an email thread first." });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an unreadable thread as a 'could not read' error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await extractEmailThreadAction(
      { status: "idle" },
      fd({ companyId: companyAId, thread: "garbled" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not read that email thread.",
    });
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await extractEmailThreadAction(
      { status: "idle" },
      fd({ companyId: companyBId, thread: "From: someone\nHi" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("saveEmailMessage", () => {
  test("lands a manual EmailMessage row scoped to this company", async () => {
    const state = await saveEmailMessage(
      { status: "idle" },
      fd({ companyId: companyAId, extraction: JSON.stringify(sample) }),
    );
    expect(state).toEqual({ status: "saved" });

    const rows = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({ where: { companyId: companyAId } }),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.subject).toBe("Kingston site tour follow-up");
    expect(row.summary).toBe(sample.summary);
    expect(row.projects).toBe("Kingston Mill Redevelopment");
    expect(row.actionItems).toBe("Send PILOT term sheet; schedule the site tour");
    expect(row.sentiment).toBe("positive");
    expect(row.fromEmail).toBe("jane@acmemills.example");
    // Manual rows are keyed manual:… so the profile card can tag them.
    expect(row.externalKey.startsWith("manual:")).toBe(true);
  });

  test("rejects an extraction with neither subject nor summary", async () => {
    const state = await saveEmailMessage(
      { status: "idle" },
      fd({
        companyId: companyAId,
        extraction: JSON.stringify({ actionItems: "call back" }),
      }),
    );
    expect(state).toEqual({ status: "error", message: "Nothing to save." });
  });

  test("refuses to write to another tenant's company (RLS → not found)", async () => {
    const state = await saveEmailMessage(
      { status: "idle" },
      fd({
        companyId: companyBId,
        extraction: JSON.stringify({ subject: "leaked" }),
      }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });

    const rows = await withOrg(orgB.id, (tx) =>
      tx.emailMessage.findMany({ where: { companyId: companyBId } }),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("deleteEmailCorrespondence", () => {
  test("refuses to delete a synced row (manual-only guard)", async () => {
    const syncedId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.emailMessage.create({
        data: {
          id: syncedId,
          orgId: orgA.id,
          companyId: companyAId,
          externalKey: `thread-${randomUUID()}`,
          subject: "Synced by Zapier",
          syncedAt: new Date(),
        },
      }),
    );

    await deleteEmailCorrespondence(fd({ id: syncedId, companyId: companyAId }));

    const survivors = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({ where: { id: syncedId } }),
    );
    expect(survivors).toHaveLength(1);
  });

  test("removes a manual row scoped to this tenant", async () => {
    const before = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({
        where: { companyId: companyAId, externalKey: { startsWith: "manual:" } },
      }),
    );
    expect(before.length).toBeGreaterThan(0);

    await deleteEmailCorrespondence(fd({ id: before[0].id, companyId: companyAId }));

    const after = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({ where: { id: before[0].id } }),
    );
    expect(after).toHaveLength(0);
  });
});
