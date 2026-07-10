import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { FocusHorizon, FocusItem } from "@/lib/daily-focus";

// Action-level integration test for generateDailyFocus (gap-audit cluster B).
// Exercises the action against the real Neon DB, mocking only the two external
// seams: Clerk (requireOrgContext) and the Anthropic engine. The load-bearing
// assertion inspects the item set the action assembled for the model — proving it
// carries THIS org's open, dated commitments and upcoming events (correctly
// sided), excludes done/undated rows, and never another tenant's data.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/daily-focus-synthesis", () => ({
  generateFocusSynthesis: genSpy,
}));

const { generateDailyFocus } = await import(
  "@/app/dashboard/daily-focus-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };
const orgC = { id: randomUUID(), name: `TENANT_C_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

// Dates relative to the real wall clock (the action reads new Date() itself), set
// comfortably inside the month window so ±1 day of TZ drift can't move them out.
function daysFromNow(n: number, hourUtc = 0): Date {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
      { ...orgC, orgType: "edc" },
    ],
  });
  await prisma.user.create({ data: staffUser });

  await withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Acme Mills",
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
    const contact = await tx.contact.create({
      data: { orgId: orgA.id, companyId: company.id, name: "Jane Doe" },
    });
    // We owe (staff-owned), overdue.
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        text: "Send the IDA draft",
        status: "open",
        ownerUserId: staffUser.id,
        dueDate: daysFromNow(-5),
      },
    });
    // They owe (contact-owned), due soon.
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        text: "Share their board deck",
        status: "open",
        ownerContactId: contact.id,
        dueDate: daysFromNow(3),
      },
    });
    // Done — must not surface.
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        text: "Closed already",
        status: "done",
        ownerContactId: contact.id,
        dueDate: daysFromNow(1),
      },
    });
    // Undated open — no urgency signal, must not surface.
    await tx.actionItem.create({
      data: {
        orgId: orgA.id,
        text: "Someday task",
        status: "open",
        ownerContactId: contact.id,
        dueDate: null,
      },
    });
    // Upcoming event — should surface.
    await tx.event.create({
      data: {
        orgId: orgA.id,
        name: "Fall Mixer",
        type: "social",
        venue: "The Grange",
        date: daysFromNow(3, 12),
      },
    });
  });

  // Org B: its own open, dated commitment — must stay invisible to A.
  await withOrg(orgB.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgB.id,
        name: "Beta Corp",
        status: "member",
        industry: "Legal",
        annualValue: 1000,
      },
    });
    const contact = await tx.contact.create({
      data: { orgId: orgB.id, companyId: company.id, name: "Other Person" },
    });
    await tx.actionItem.create({
      data: {
        orgId: orgB.id,
        text: "Foreign commitment",
        status: "open",
        ownerContactId: contact.id,
        dueDate: daysFromNow(2),
      },
    });
  });

  // Org C is left empty for the empty-state case.

  mockCtx.orgId = orgA.id;
  mockCtx.userName = "Alex";
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id, orgC.id] } },
  });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

function fd(horizon: string): FormData {
  const f = new FormData();
  f.set("horizon", horizon);
  return f;
}

describe("generateDailyFocus action", () => {
  test("assembles this org's own open, dated focus items for the model", async () => {
    mockCtx.orgId = orgA.id;
    genSpy.mockResolvedValue("Two or three sentences.");

    const state = await generateDailyFocus({ status: "idle" }, fd("month"));
    expect(state.status).toBe("ok");
    if (state.status !== "ok") throw new Error("unreachable");
    expect(state.horizon).toBe("month");
    expect(state.synthesis).toBe("Two or three sentences.");

    // The engine received the horizon and user name the action resolved.
    expect(genSpy).toHaveBeenCalledTimes(1);
    const items = genSpy.mock.calls[0][0] as FocusItem[];
    const horizonArg = genSpy.mock.calls[0][1] as FocusHorizon;
    const userArg = genSpy.mock.calls[0][2] as string;
    expect(horizonArg).toBe("month");
    expect(userArg).toBe("Alex");

    const texts = items.map((i) => i.text);
    expect(texts).toContain("Send the IDA draft");
    expect(texts).toContain("Share their board deck");
    expect(texts).toContain("Fall Mixer");
    // Done, undated, and org B's item are all absent.
    expect(texts).not.toContain("Closed already");
    expect(texts).not.toContain("Someday task");
    expect(texts).not.toContain("Foreign commitment");

    // Sides render into the detail line; the event sorts ahead of commitments.
    expect(items[0].kind).toBe("event");
    const we = items.find((i) => i.text === "Send the IDA draft")!;
    const they = items.find((i) => i.text === "Share their board deck")!;
    expect(we.detail).toContain("We owe");
    expect(they.detail).toContain("They owe");
    expect(they.detail).toContain("Acme Mills");
  });

  test("returns empty state for an org with no time-bound items", async () => {
    mockCtx.orgId = orgC.id;
    const state = await generateDailyFocus({ status: "idle" }, fd("today"));
    expect(state).toEqual({ status: "empty", horizon: "today" });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("rejects an invalid horizon before touching the DB", async () => {
    mockCtx.orgId = orgA.id;
    const state = await generateDailyFocus({ status: "idle" }, fd("year"));
    expect(state).toEqual({ status: "error", message: "invalid horizon" });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an engine failure as inline error state", async () => {
    mockCtx.orgId = orgA.id;
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await generateDailyFocus({ status: "idle" }, fd("month"));
    expect(state).toEqual({
      status: "error",
      message: "Could not write your briefing. Try again.",
    });
  });
});
