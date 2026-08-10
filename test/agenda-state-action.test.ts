import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the Daily Focus triage overlay (slice 11.z12,
// Dashboard 8). Exercises setAgendaItemState against the real Neon DB, mocking only
// Clerk: an upsert marks/updates a focus item, a snooze stamps a deadline, "clear"
// removes the overlay, a malformed kind is refused, and one tenant's marks are
// invisible to another (RLS).

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { setAgendaItemState } = await import("@/app/dashboard/daily-focus-actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const refA = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  mockCtx.orgId = orgA.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

async function rowFor(orgId: string, refId: string) {
  return withOrg(orgId, (tx) =>
    tx.agendaItemState.findFirst({ where: { refId } }),
  );
}

describe("setAgendaItemState", () => {
  test("marks a focus item and re-triaging is an idempotent upsert", async () => {
    const first = await setAgendaItemState("commitment", refA, "waiting");
    expect(first.status).toBe("ok");

    const row = await rowFor(orgA.id, refA);
    expect(row).toMatchObject({ kind: "commitment", state: "waiting" });
    expect(row?.snoozedUntil).toBeNull();

    // Same (kind, refId) → the unique upsert flips state without a second row.
    const again = await setAgendaItemState("commitment", refA, "done");
    expect(again.status).toBe("ok");

    const rows = await withOrg(orgA.id, (tx) =>
      tx.agendaItemState.findMany({ where: { refId: refA } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("done");
  });

  test("snoozing stamps a future deadline", async () => {
    const ref = randomUUID();
    await setAgendaItemState("event", ref, "snoozed");
    const row = await rowFor(orgA.id, ref);
    expect(row?.state).toBe("snoozed");
    expect(row?.snoozedUntil).not.toBeNull();
    expect(row!.snoozedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  test("clear removes the overlay", async () => {
    const ref = randomUUID();
    await setAgendaItemState("commitment", ref, "waiting");
    expect(await rowFor(orgA.id, ref)).not.toBeNull();

    const cleared = await setAgendaItemState("commitment", ref, "clear");
    expect(cleared.status).toBe("ok");
    expect(await rowFor(orgA.id, ref)).toBeNull();
  });

  test("a malformed kind is refused and writes nothing", async () => {
    const ref = randomUUID();
    const result = await setAgendaItemState("project", ref, "done");
    expect(result.status).toBe("error");
    expect(await rowFor(orgA.id, ref)).toBeNull();
  });

  test("one tenant's overlay is invisible to another (RLS)", async () => {
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.agendaItemState.findMany({ where: { refId: refA } }),
    );
    expect(seenByB).toEqual([]);
  });
});
