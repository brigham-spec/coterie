import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { EventIdeasInput } from "@/lib/event-ideas";

// Action-level integration test for the event-suggestions action (gap-audit
// cluster D). Exercises suggestEvents against the real Neon DB (RLS on), mocking
// only the two external seams (Clerk + the Anthropic engine). The load-bearing
// assertion inspects the CONTEXT the action assembled and handed to the engine:
// it must contain only the caller's own non-former companies, flag "never
// invited" correctly (a company on an event guest list is NOT never-invited), and
// never leak another tenant's rows.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/event-ideas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/event-ideas")>();
  return { ...actual, generateEventIdeas: genSpy };
});

const { suggestEvents } = await import("@/app/dashboard/events/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };
const orgEmpty = { id: randomUUID(), name: `TENANT_EMPTY_${randomUUID()}` };

const a = {
  memberNever: randomUUID(),
  memberInvited: randomUUID(),
  former: randomUUID(),
  invitedContact: randomUUID(),
  project: randomUUID(),
  meeting: randomUUID(),
  event: randomUUID(),
};

const base = { industry: "Legal", annualValue: 1000 };

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
      { ...orgEmpty, orgType: "council" },
    ],
  });

  await withOrg(orgA.id, async (tx: Prisma.TransactionClient) => {
    await tx.company.create({
      data: { id: a.memberNever, orgId: orgA.id, name: "Never Invited Co", status: "member", ...base },
    });
    await tx.company.create({
      data: { id: a.memberInvited, orgId: orgA.id, name: "Invited Co", status: "member", ...base },
    });
    await tx.company.create({
      data: { id: a.former, orgId: orgA.id, name: "Former Co", status: "former", ...base },
    });
    await tx.contact.create({
      data: { id: a.invitedContact, orgId: orgA.id, companyId: a.memberInvited, name: "Guest One" },
    });
    await tx.project.create({
      data: { id: a.project, orgId: orgA.id, name: "Active A", stage: "concept", type: "Mixed-Use", county: "Ulster" },
    });
    await tx.meeting.create({
      data: { id: a.meeting, orgId: orgA.id, title: "Capital sync", heldAt: new Date("2026-05-01"), summary: "Talked financing." },
    });
    await tx.event.create({
      data: { id: a.event, orgId: orgA.id, name: "Spring Dinner", type: "member_dinner", stage: "completed", date: new Date("2026-03-01") },
    });
    await tx.eventInvitee.create({
      data: { orgId: orgA.id, eventId: a.event, contactId: a.invitedContact, rsvp: "attended" },
    });
  });

  await withOrg(orgB.id, (tx) =>
    tx.company.create({ data: { orgId: orgB.id, name: "Member B", status: "member", ...base } }),
  );

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id, orgEmpty.id] } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  genSpy.mockReset();
});

describe("suggestEvents action", () => {
  test("hands the engine only the caller's scoped network, with correct never-invited flags", async () => {
    genSpy.mockResolvedValue([]);

    const state = await suggestEvents({ status: "idle" }, new FormData());
    expect(state).toEqual({ status: "ok", ideas: [] });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const input = genSpy.mock.calls[0][0] as EventIdeasInput;

    const names = input.members.map((m) => m.name);
    expect(names).toContain("Never Invited Co");
    expect(names).toContain("Invited Co");
    expect(names).not.toContain("Former Co"); // former excluded
    expect(names).not.toContain("Member B"); // other tenant never visible

    const byName = new Map(input.members.map((m) => [m.name, m]));
    expect(byName.get("Never Invited Co")?.neverInvited).toBe(true);
    // Invited Co has a contact on a real event guest list → not never-invited.
    expect(byName.get("Invited Co")?.neverInvited).toBe(false);

    // active projects, recent meetings, past events — all this tenant's.
    expect(input.projects.map((p) => p.name)).toEqual(["Active A"]);
    expect(input.recentMeetings.map((m) => m.title)).toContain("Capital sync");
    expect(input.eventHistory.map((e) => e.name)).toContain("Spring Dinner");
    // The completed event with an attending guest reports one attendee.
    expect(input.eventHistory.find((e) => e.name === "Spring Dinner")?.attended).toBe(1);
  });

  test("surfaces an engine failure as inline error state", async () => {
    genSpy.mockRejectedValue(new Error("boom"));
    const state = await suggestEvents({ status: "idle" }, new FormData());
    expect(state).toEqual({
      status: "error",
      message: "Could not suggest events. Try again.",
    });
  });

  test("returns empty (without calling the engine) when the tenant has no companies", async () => {
    mockCtx.orgId = orgEmpty.id;
    mockCtx.orgName = orgEmpty.name;
    genSpy.mockResolvedValue([]);

    const state = await suggestEvents({ status: "idle" }, new FormData());
    expect(state).toEqual({ status: "empty" });
    expect(genSpy).not.toHaveBeenCalled();

    mockCtx.orgId = orgA.id;
    mockCtx.orgName = orgA.name;
  });
});
