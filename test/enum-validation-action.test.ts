import { describe, expect, test, vi, beforeEach } from "vitest";

// Action-wiring test for the write-boundary enum validation (pre-launch hardening).
// The client <select>s constrain these fields in normal use, but a forged POST must
// still be refused. Validation runs AFTER auth but BEFORE any DB work, so we mock
// both seams: a stubbed requireOrgContext, and a withOrg spy that must NEVER be
// reached when the value is out of vocabulary. Pure (no Neon).

const withOrgSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => ({
    orgId: "00000000-0000-4000-8000-000000000000",
    orgName: "T",
    userId: "u",
    userName: "U",
  })),
}));
vi.mock("@/lib/tenant", () => ({ withOrg: withOrgSpy }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createCompany } = await import("@/app/dashboard/companies/actions");
const { createProject, updateStage } = await import(
  "@/app/dashboard/projects/actions"
);
const { createIntroduction } = await import(
  "@/app/dashboard/introductions/actions"
);
const { createEvent, updateEventStage, updateInviteeRsvp } = await import(
  "@/app/dashboard/events/actions"
);

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => withOrgSpy.mockReset());

describe("write-boundary enum validation", () => {
  test("createCompany rejects an out-of-vocabulary status before any DB write", async () => {
    await expect(
      createCompany(fd({ name: "Acme", status: "vip", industry: "Manufacturing" })),
    ).rejects.toThrow(/invalid company status/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("createProject rejects an invalid stage", async () => {
    await expect(
      createProject(fd({ name: "Riverfront", stage: "mystery" })),
    ).rejects.toThrow(/invalid project stage/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("updateStage rejects an invalid stage", async () => {
    await expect(
      updateStage(fd({ projectId: "p", stage: "mystery" })),
    ).rejects.toThrow(/invalid project stage/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("createIntroduction rejects an invalid status", async () => {
    await expect(
      createIntroduction(
        fd({ partyAContactId: "a", partyBContactId: "b", status: "mystery" }),
      ),
    ).rejects.toThrow(/invalid introduction status/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("createEvent rejects an invalid type and an invalid stage", async () => {
    await expect(
      createEvent(fd({ name: "Dinner", type: "rave" })),
    ).rejects.toThrow(/invalid event type/);
    await expect(
      createEvent(fd({ name: "Dinner", type: "member_dinner", stage: "mystery" })),
    ).rejects.toThrow(/invalid event stage/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("updateEventStage rejects an invalid stage", async () => {
    await expect(
      updateEventStage(fd({ eventId: "e", stage: "mystery" })),
    ).rejects.toThrow(/invalid event stage/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });

  test("updateInviteeRsvp rejects an invalid rsvp state", async () => {
    await expect(
      updateInviteeRsvp(fd({ inviteeId: "i", rsvp: "maybe" })),
    ).rejects.toThrow(/invalid rsvp state/);
    expect(withOrgSpy).not.toHaveBeenCalled();
  });
});
