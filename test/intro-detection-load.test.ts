import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";

// Action-level integration test for the pending intro-advance loader (gap-audit
// cluster A). Exercises loadPendingIntroDetections against the real Neon DB with
// RLS on. Proves it (a) proposes an advance when a meeting held after an in-flight
// intro brought both parties' companies together, (b) scopes to one company when
// asked, and (c) never surfaces another tenant's introductions.

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// Org A: two companies with a "made" intro between them, evidenced by a later
// meeting both attended. Plus a self-contained "already advanced" intro and a
// third uninvolved company that scoping must exclude.
const a = {
  co1: randomUUID(),
  co2: randomUUID(),
  co3: randomUUID(),
  ct1: randomUUID(),
  ct2: randomUUID(),
  intro: randomUUID(),
  introAdvanced: randomUUID(),
  meetingAfter: randomUUID(),
  meetingBefore: randomUUID(),
};

// Org B: its own made intro + confirming meeting — must stay invisible to A.
const b = {
  co1: randomUUID(),
  co2: randomUUID(),
  ct1: randomUUID(),
  ct2: randomUUID(),
  intro: randomUUID(),
  meeting: randomUUID(),
};

async function seedCompany(
  tx: Prisma.TransactionClient,
  orgId: string,
  id: string,
  name: string,
) {
  await tx.company.create({
    data: { id, orgId, name, status: "member", industry: "Manufacturing", annualValue: 1000 },
  });
}

async function seedContact(
  tx: Prisma.TransactionClient,
  orgId: string,
  id: string,
  companyId: string,
  name: string,
) {
  await tx.contact.create({ data: { id, orgId, companyId, name } });
}

async function seedMeetingWith(
  tx: Prisma.TransactionClient,
  orgId: string,
  id: string,
  title: string,
  heldAt: string,
  contactIds: string[],
) {
  await tx.meeting.create({
    data: { id, orgId, title, heldAt: new Date(heldAt) },
  });
  for (const contactId of contactIds) {
    await tx.meetingAttendee.create({
      data: { orgId, meetingId: id, contactId, matchMethod: "manual", confidence: 1 },
    });
  }
}

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await seedCompany(tx, orgA.id, a.co1, "Acme Mills");
    await seedCompany(tx, orgA.id, a.co2, "Bolt Foundry");
    await seedCompany(tx, orgA.id, a.co3, "Cog Works");
    await seedContact(tx, orgA.id, a.ct1, a.co1, "Jane Doe");
    await seedContact(tx, orgA.id, a.ct2, a.co2, "Sam Poe");

    await tx.introduction.create({
      data: {
        id: a.intro,
        orgId: orgA.id,
        partyAContactId: a.ct1,
        partyBContactId: a.ct2,
        status: "made",
        source: "manual",
        madeOn: new Date("2026-01-01"),
      },
    });
    // Already at meeting_set — a later meeting must NOT re-propose it.
    await tx.introduction.create({
      data: {
        id: a.introAdvanced,
        orgId: orgA.id,
        partyAContactId: a.ct1,
        partyBContactId: a.ct2,
        status: "meeting_set",
        source: "manual",
        madeOn: new Date("2026-01-01"),
      },
    });

    // Evidence: a meeting AFTER the intro with both companies present.
    await seedMeetingWith(tx, orgA.id, a.meetingAfter, "Kickoff", "2026-02-15", [
      a.ct1,
      a.ct2,
    ]);
    // A meeting BEFORE the intro (both present) must not qualify as evidence.
    await seedMeetingWith(tx, orgA.id, a.meetingBefore, "Cold intro", "2025-12-01", [
      a.ct1,
      a.ct2,
    ]);
  });

  await withOrg(orgB.id, async (tx) => {
    await seedCompany(tx, orgB.id, b.co1, "Foreign One");
    await seedCompany(tx, orgB.id, b.co2, "Foreign Two");
    await seedContact(tx, orgB.id, b.ct1, b.co1, "Other A");
    await seedContact(tx, orgB.id, b.ct2, b.co2, "Other B");
    await tx.introduction.create({
      data: {
        id: b.intro,
        orgId: orgB.id,
        partyAContactId: b.ct1,
        partyBContactId: b.ct2,
        status: "made",
        source: "manual",
        madeOn: new Date("2026-01-01"),
      },
    });
    await seedMeetingWith(tx, orgB.id, b.meeting, "Foreign kickoff", "2026-02-20", [
      b.ct1,
      b.ct2,
    ]);
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("loadPendingIntroDetections", () => {
  test("proposes advancing the made intro, evidenced by the later meeting", async () => {
    const out = await withOrg(orgA.id, (tx) => loadPendingIntroDetections(tx));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      introId: a.intro,
      suggestedStage: "meeting_set",
      currentStage: "made",
      partyALabel: "Acme Mills",
      partyBLabel: "Bolt Foundry",
      meetingId: a.meetingAfter,
      meetingTitle: "Kickoff",
    });
  });

  test("scopes to a company when asked; unrelated company yields none", async () => {
    const forCo1 = await withOrg(orgA.id, (tx) =>
      loadPendingIntroDetections(tx, a.co1),
    );
    expect(forCo1.map((d) => d.introId)).toEqual([a.intro]);

    const forCo3 = await withOrg(orgA.id, (tx) =>
      loadPendingIntroDetections(tx, a.co3),
    );
    expect(forCo3).toHaveLength(0);
  });

  test("never surfaces another tenant's introductions (RLS)", async () => {
    const out = await withOrg(orgB.id, (tx) => loadPendingIntroDetections(tx));
    expect(out.map((d) => d.introId)).toEqual([b.intro]);
    expect(out.some((d) => d.introId === a.intro)).toBe(false);
  });
});
