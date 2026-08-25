import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { reconcileTranscripts } from "@/lib/fireflies-reconcile";
import type { FirefliesTranscript } from "@/lib/fireflies";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Tier-3 staff attribution: reconcileTranscripts must record which of the org's
// OWN staff attended a synced meeting (by matching the attendee email against the
// org's users) so the dashboard can scope New Connections to "my meetings". A
// staffer must be recorded as staff attendance ONLY — never matched as a contact
// and never captured as their own "new connection". Runs against the real Neon
// DB; reconcile takes orgId directly, so no Clerk mock is needed.

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffAEmail = `staff_a_${randomUUID()}@acme.example`;
const staffA = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: staffAEmail,
  name: "Staff A",
};
const staffBEmail = `staff_b_${randomUUID()}@beta.example`;
const staffB = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: staffBEmail,
  name: "Staff B",
};

const companyAId = randomUUID();
const contactAId = randomUUID();
const contactAEmail = `ada_${randomUUID()}@acme.example`;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.createMany({ data: [staffA, staffB] });
  await prisma.orgMembership.createMany({
    data: [
      { orgId: orgA.id, userId: staffA.id, role: "staff" },
      { orgId: orgB.id, userId: staffB.id, role: "staff" },
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
        emailDomain: "acme.example",
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Ada Acme",
        email: contactAEmail,
      },
    });
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [staffA.id, staffB.id] } } });
  await prisma.$disconnect();
});

function transcript(overrides: Partial<FirefliesTranscript>): FirefliesTranscript {
  return {
    id: randomUUID(),
    title: "Quarterly check-in",
    date: Date.UTC(2026, 7, 1),
    transcript_url: null,
    summary: { overview: "Good conversation.", action_items: null },
    meeting_attendees: [],
    ...overrides,
  };
}

describe("reconcileTranscripts staff attribution", () => {
  test("records the org's staffer as attendance, not a contact or new connection", async () => {
    const strangerEmail = `stranger_${randomUUID()}@vendor.example`;
    const t = transcript({
      title: "Acme sync",
      meeting_attendees: [
        // Staffer (email matches an org user, uppercased to prove normalization).
        { displayName: "Staff A", email: staffAEmail.toUpperCase(), name: null },
        // A real contact on the company.
        { displayName: "Ada Acme", email: contactAEmail, name: null },
        // An org-domain stranger -> a genuine new connection.
        { displayName: "Vic Vendor", email: strangerEmail, name: null },
      ],
    });

    await reconcileTranscripts(orgA.id, [t]);

    const meeting = await withOrg(orgA.id, (tx) =>
      tx.meeting.findFirst({
        where: { firefliesId: t.id },
        select: {
          id: true,
          staffAttendees: { select: { userId: true } },
          attendees: { select: { contactId: true } },
        },
      }),
    );
    // Staffer recorded as staff attendance...
    expect(meeting?.staffAttendees).toEqual([{ userId: staffA.id }]);
    // ...and the contact is the ONLY meeting-attendee (staffer not among them).
    expect(meeting?.attendees).toEqual([{ contactId: contactAId }]);

    // The staffer is never captured as a new connection; the stranger is.
    const unmatchedEmails = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findMany({ select: { email: true } }),
    );
    const emails = unmatchedEmails.map((u) => u.email);
    expect(emails).toContain(strangerEmail.toLowerCase());
    expect(emails).not.toContain(staffAEmail.toLowerCase());
  });

  test("is idempotent — re-syncing keeps one staff-attendance row", async () => {
    const t = transcript({
      meeting_attendees: [{ displayName: "Staff A", email: staffAEmail, name: null }],
    });

    await reconcileTranscripts(orgA.id, [t]);
    await reconcileTranscripts(orgA.id, [t]);

    const count = await withOrg(orgA.id, (tx) =>
      tx.meetingStaffAttendee.count({ where: { userId: staffA.id } }),
    );
    // Two runs of two distinct meetings (this + the prior test) => 2, not 4.
    expect(count).toBe(2);
  });

  test("advances the matched contact's company last-contact clock, forward-only", async () => {
    const companyId = randomUUID();
    const contactId = randomUUID();
    const contactEmail = `cora_${randomUUID()}@acme.example`;
    await withOrg(orgA.id, async (tx) => {
      await tx.company.create({
        data: {
          id: companyId,
          orgId: orgA.id,
          name: "Cold Co",
          status: "member",
          industry: "Manufacturing",
          annualValue: 1000,
          emailDomain: "acme.example",
        },
      });
      await tx.contact.create({
        data: {
          id: contactId,
          orgId: orgA.id,
          companyId,
          name: "Cora Cold",
          email: contactEmail,
        },
      });
    });

    // A recent meeting freshens the clock from null to heldAt.
    const recent = transcript({
      date: Date.UTC(2026, 7, 10),
      meeting_attendees: [{ displayName: "Cora Cold", email: contactEmail, name: null }],
    });
    await reconcileTranscripts(orgA.id, [recent]);

    const afterRecent = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({ where: { id: companyId }, select: { lastContactAt: true } }),
    );
    expect(afterRecent?.lastContactAt?.getTime()).toBe(Date.UTC(2026, 7, 10));

    // An older backfilled meeting must NOT roll the clock backwards.
    const older = transcript({
      date: Date.UTC(2026, 6, 1),
      meeting_attendees: [{ displayName: "Cora Cold", email: contactEmail, name: null }],
    });
    await reconcileTranscripts(orgA.id, [older]);

    const afterOlder = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({ where: { id: companyId }, select: { lastContactAt: true } }),
    );
    expect(afterOlder?.lastContactAt?.getTime()).toBe(Date.UTC(2026, 7, 10));
  });

  test("another tenant's staff email is not attributed here (org-scoped match)", async () => {
    const t = transcript({
      title: "Cross-tenant probe",
      meeting_attendees: [{ displayName: "Staff B", email: staffBEmail, name: null }],
    });

    await reconcileTranscripts(orgA.id, [t]);

    // orgB's staffer is invisible to orgA's user map -> no staff link; and being
    // an org-domain address he falls through to a new connection instead.
    const link = await withOrg(orgA.id, (tx) =>
      tx.meetingStaffAttendee.count({ where: { userId: staffB.id } }),
    );
    expect(link).toBe(0);

    // orgB sees none of orgA's staff-attendance rows (RLS silo).
    const inB = await withOrg(orgB.id, (tx) =>
      tx.meetingStaffAttendee.count(),
    );
    expect(inB).toBe(0);
  });
});
