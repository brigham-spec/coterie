import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P1 editable-profile slice
// (updateCompany + changeCompanyStatus). Runs against the real Neon DB, mocking
// only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// whitelisted field write, that a status transition is journaled as a
// status_changed Activity (with a from/to payload, so the relationship timeline
// reflects the lifecycle), that a no-op status change writes nothing, that
// unknown network tags and duplicate counties are sanitized, and — the cardinal
// rule — that a foreign company id is refused by RLS and leaves the other tenant
// untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// deleteCompany redirects to the directory once the row is gone; a real redirect
// throws NEXT_REDIRECT, so stub it to a no-op for the action-level assertion.
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { updateCompany, changeCompanyStatus, deleteCompany } = await import(
  "@/app/dashboard/companies/[id]/actions"
);
const { createCompany } = await import("@/app/dashboard/companies/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

// A second member of orgA — a valid owner target. And an outsider user that
// exists but belongs only to orgB, so it must be refused as an orgA owner.
const secondStaffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff2_${randomUUID()}@example.com`,
  name: "Second Staffer",
};
const outsiderUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `outsider_${randomUUID()}@example.com`,
  name: "Outsider",
};

const companyAId = randomUUID();
const statusCompanyId = randomUUID();
const companyBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      // orgA configures ranked member tiers so the write-boundary accepts these
      // labels AND a member's tier auto-assigns from annualValue (25000 clears
      // Director's 20000 threshold but not Chairman's 50000).
      {
        ...orgA,
        orgType: "edc",
        settings: {
          memberTiers: [
            { label: "Chairman", minValue: 50000 },
            { label: "Director", minValue: 20000 },
            { label: "Advisory", minValue: 1 },
          ],
        },
      },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.createMany({
    data: [staffUser, secondStaffUser, outsiderUser],
  });
  await prisma.orgMembership.createMany({
    data: [
      { orgId: orgA.id, userId: staffUser.id, role: "staff" },
      { orgId: orgA.id, userId: secondStaffUser.id, role: "staff" },
      // outsiderUser is a member of orgB only — never of orgA.
      { orgId: orgB.id, userId: outsiderUser.id, role: "staff" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyAId,
        orgId: orgA.id,
        name: "Acme Mills",
        status: "prospect",
        industry: "Manufacturing",
        annualValue: 1000,
        notes: "Existing note.",
      },
    });
    await tx.company.create({
      data: {
        id: statusCompanyId,
        orgId: orgA.id,
        name: "Lifecycle Co",
        status: "prospect",
        industry: "Retail",
        annualValue: 1000,
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
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [staffUser.id, secondStaffUser.id, outsiderUser.id] } },
  });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item);
    else f.set(k, v);
  }
  return f;
}

describe("updateCompany", () => {
  test("writes the whitelisted fields, sanitizes counties + network tags, and logs the status change", async () => {
    await updateCompany(
      fd({
        companyId: companyAId,
        status: "member",
        industry: "Advanced Manufacturing",
        annualValue: "25000",
        tier: "Director",
        temperature: "80",
        website: "https://acme.test",
        emailDomain: "acme.test",
        source: "referral",
        memberSince: "2024",
        dealSize: "$1-5M",
        lookingFor: "growth capital",
        canOffer: "manufacturing capacity",
        agencyContacts: "Jane at the IDA",
        venue: "The Foundry Hall",
        notes: "Fresh notes.",
        counties: "Ulster, Dutchess, Ulster, ",
        networkTags: ["seeking_equity", "not_a_real_tag", "ida_active"],
      }),
    );

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: {
          status: true,
          industry: true,
          annualValue: true,
          tier: true,
          temperature: true,
          website: true,
          emailDomain: true,
          source: true,
          memberSince: true,
          dealSize: true,
          lookingFor: true,
          canOffer: true,
          agencyContacts: true,
          venue: true,
          notes: true,
          counties: true,
          networkTags: true,
        },
      }),
    );
    expect(company!.status).toBe("member");
    expect(company!.industry).toBe("Advanced Manufacturing");
    expect(Number(company!.annualValue)).toBe(25000);
    expect(company!.tier).toBe("Director");
    expect(company!.temperature).toBe(80);
    expect(company!.website).toBe("https://acme.test");
    expect(company!.emailDomain).toBe("acme.test");
    expect(company!.source).toBe("referral");
    expect(company!.memberSince).toBe(2024);
    expect(company!.dealSize).toBe("$1-5M");
    expect(company!.lookingFor).toBe("growth capital");
    expect(company!.canOffer).toBe("manufacturing capacity");
    expect(company!.agencyContacts).toBe("Jane at the IDA");
    expect(company!.venue).toBe("The Foundry Hall");
    expect(company!.notes).toBe("Fresh notes.");
    // Counties: trimmed + de-duped (order preserved), blank dropped.
    expect(company!.counties).toEqual(["Ulster", "Dutchess"]);
    // Only known org-tag keys survive.
    expect(company!.networkTags).toEqual(["seeking_equity", "ida_active"]);

    // The prospect → member transition was journaled.
    const activities = await withOrg(orgA.id, (tx) =>
      tx.activity.findMany({
        where: { companyId: companyAId, type: "status_changed" },
        select: { payload: true, actorUserId: true },
      }),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].payload).toMatchObject({ from: "prospect", to: "member" });
    expect(activities[0].actorUserId).toBe(staffUser.id);
  });

  test("does not log an Activity when the status is unchanged", async () => {
    // companyA is already 'member' from the prior test; re-save with same status.
    await updateCompany(
      fd({
        companyId: companyAId,
        status: "member",
        industry: "Advanced Manufacturing",
        annualValue: "25000",
        notes: "Fresh notes.",
      }),
    );
    const count = await withOrg(orgA.id, (tx) =>
      tx.activity.count({
        where: { companyId: companyAId, type: "status_changed" },
      }),
    );
    expect(count).toBe(1);
  });

  test("rejects an unknown status", async () => {
    await expect(
      updateCompany(
        fd({ companyId: companyAId, status: "vip", industry: "X" }),
      ),
    ).rejects.toThrow("invalid company status");
  });

  test("requires an industry", async () => {
    await expect(
      updateCompany(
        fd({ companyId: companyAId, status: "member", industry: "  " }),
      ),
    ).rejects.toThrow("industry is required");
  });

  test("refuses a company id from another tenant and leaves it untouched", async () => {
    await expect(
      updateCompany(
        fd({
          companyId: companyBId,
          status: "former",
          industry: "Hijacked",
        }),
      ),
    ).rejects.toThrow("company not found in this organization");

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyBId },
        select: { status: true, industry: true },
      }),
    );
    expect(companyB!.status).toBe("member");
    expect(companyB!.industry).toBe("Legal");
  });
});

describe("updateCompany member tier", () => {
  const tierFd = (tier: string) =>
    fd({
      companyId: statusCompanyId,
      status: "prospect",
      industry: "Retail",
      annualValue: "1000",
      tier,
    });

  test("accepts a configured tier", async () => {
    await updateCompany(tierFd("Advisory"));
    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: statusCompanyId },
        select: { tier: true },
      }),
    );
    expect(company!.tier).toBe("Advisory");
  });

  test("rejects a tier the org has not configured", async () => {
    await expect(updateCompany(tierFd("Emperor"))).rejects.toThrow(
      "tier is not configured for this organization",
    );
  });

  test("allows re-saving a stored tier that is no longer configured", async () => {
    // Simulate a legacy value: write a tier directly, then re-save unchanged.
    await withOrg(orgA.id, (tx) =>
      tx.company.update({
        where: { id: statusCompanyId },
        data: { tier: "Legacy Rank" },
      }),
    );
    await expect(updateCompany(tierFd("Legacy Rank"))).resolves.toBeUndefined();
  });

  test("clears the tier when left blank", async () => {
    await updateCompany(tierFd(""));
    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: statusCompanyId },
        select: { tier: true },
      }),
    );
    expect(company!.tier).toBeNull();
  });
});

describe("updateCompany auto-tier override", () => {
  // companyAId is a member of orgA, whose configured tiers are Chairman ≥50000,
  // Director ≥20000, Advisory ≥1. The override toggle (tierLocked): unlocked
  // members auto-assign from annual value and discard the submitted tier; locked
  // members honor the hand-picked tier even when it disagrees with the value.
  function tierFd(fields: Record<string, string>): FormData {
    return fd({
      companyId: companyAId,
      status: "member",
      industry: "Advanced Manufacturing",
      annualValue: "25000",
      ...fields,
    });
  }

  function readTier() {
    return withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { tier: true, tierLocked: true },
      }),
    );
  }

  test("auto-assigns from annual value, discarding the submitted tier when unlocked", async () => {
    // 25000 clears Director (20000) but not Chairman (50000); the submitted
    // "Chairman" is ignored because the tier is not locked.
    await updateCompany(tierFd({ annualValue: "25000", tier: "Chairman" }));
    const company = await readTier();
    expect(company!.tier).toBe("Director");
    expect(company!.tierLocked).toBe(false);
  });

  test("auto-assigns the top tier when annual value clears its threshold", async () => {
    await updateCompany(tierFd({ annualValue: "60000", tier: "Advisory" }));
    const company = await readTier();
    expect(company!.tier).toBe("Chairman");
  });

  test("honors a locked manual tier even when annual value disagrees", async () => {
    await updateCompany(
      tierFd({ annualValue: "25000", tier: "Chairman", tierLocked: "on" }),
    );
    const company = await readTier();
    expect(company!.tier).toBe("Chairman");
    expect(company!.tierLocked).toBe(true);
  });

  test("resumes auto-assignment once the lock is cleared", async () => {
    await updateCompany(
      tierFd({ annualValue: "25000", tier: "Chairman", tierLocked: "on" }),
    );
    await updateCompany(tierFd({ annualValue: "25000", tier: "Chairman" }));
    const company = await readTier();
    expect(company!.tier).toBe("Director");
    expect(company!.tierLocked).toBe(false);
  });

  test("keeps the existing tier when annual value clears no ranked threshold", async () => {
    // Seed a standing (Director) via a lock, then clear the lock and save with an
    // annual value below every ranked threshold (Advisory ≥1). Auto-assignment
    // returns null there; the save must preserve the existing tier rather than
    // blanking it, so an unrelated field edit can't erase a member's standing.
    await updateCompany(
      tierFd({ annualValue: "25000", tier: "Director", tierLocked: "on" }),
    );
    await updateCompany(tierFd({ annualValue: "0", tier: "" }));
    const company = await readTier();
    expect(company!.tier).toBe("Director");
    expect(company!.tierLocked).toBe(false);
  });
});

describe("updateCompany owner reassignment", () => {
  function ownerFd(ownerUserId: string): FormData {
    return fd({
      companyId: companyAId,
      status: "member",
      industry: "Advanced Manufacturing",
      annualValue: "25000",
      ownerUserId,
    });
  }

  test("assigns an owner who is a member of this org", async () => {
    await updateCompany(ownerFd(secondStaffUser.id));

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { ownerUserId: true },
      }),
    );
    expect(company!.ownerUserId).toBe(secondStaffUser.id);
  });

  test("clears the owner when left blank", async () => {
    await updateCompany(ownerFd(""));

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { ownerUserId: true },
      }),
    );
    expect(company!.ownerUserId).toBeNull();
  });

  test("refuses a user who is not a member of this org and leaves the owner untouched", async () => {
    // Seed a known owner so we can prove the rejected write changed nothing.
    await updateCompany(ownerFd(secondStaffUser.id));

    await expect(updateCompany(ownerFd(outsiderUser.id))).rejects.toThrow(
      "owner is not a member of this organization",
    );

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { ownerUserId: true },
      }),
    );
    expect(company!.ownerUserId).toBe(secondStaffUser.id);
  });
});

describe("updateCompany referral source", () => {
  function referFd(fields: Record<string, string>): FormData {
    return fd({
      companyId: companyAId,
      status: "member",
      industry: "Advanced Manufacturing",
      annualValue: "25000",
      ...fields,
    });
  }

  function readReferral() {
    return withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { referredById: true, referredByExternal: true },
      }),
    );
  }

  test("links an in-network referrer from this org", async () => {
    await updateCompany(referFd({ referredById: statusCompanyId }));
    const company = await readReferral();
    expect(company!.referredById).toBe(statusCompanyId);
    expect(company!.referredByExternal).toBeNull();
  });

  test("an in-network referrer wins and clears any external name", async () => {
    await updateCompany(
      referFd({ referredById: statusCompanyId, referredByExternal: "Someone Else" }),
    );
    const company = await readReferral();
    expect(company!.referredById).toBe(statusCompanyId);
    expect(company!.referredByExternal).toBeNull();
  });

  test("records an external referrer when no in-network one is picked", async () => {
    await updateCompany(referFd({ referredByExternal: "Jamie Rivera" }));
    const company = await readReferral();
    expect(company!.referredById).toBeNull();
    expect(company!.referredByExternal).toBe("Jamie Rivera");
  });

  test("clears both when left blank", async () => {
    await updateCompany(referFd({ referredById: statusCompanyId }));
    await updateCompany(referFd({ referredById: "", referredByExternal: "" }));
    const company = await readReferral();
    expect(company!.referredById).toBeNull();
    expect(company!.referredByExternal).toBeNull();
  });

  test("refuses a company that refers itself", async () => {
    await expect(
      updateCompany(referFd({ referredById: companyAId })),
    ).rejects.toThrow("a company cannot refer itself");
  });

  test("refuses an in-network referrer from another tenant and leaves the referral untouched", async () => {
    // Seed a known referrer so the rejected write can be shown to change nothing.
    await updateCompany(referFd({ referredById: statusCompanyId }));

    await expect(
      updateCompany(referFd({ referredById: companyBId })),
    ).rejects.toThrow("referrer is not a company in this organization");

    const company = await readReferral();
    expect(company!.referredById).toBe(statusCompanyId);
  });
});

describe("changeCompanyStatus", () => {
  test("transitions the status and journals the change", async () => {
    await changeCompanyStatus(
      fd({ companyId: statusCompanyId, status: "member" }),
    );

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: statusCompanyId },
        select: { status: true },
      }),
    );
    expect(company!.status).toBe("member");

    const activities = await withOrg(orgA.id, (tx) =>
      tx.activity.findMany({
        where: { companyId: statusCompanyId, type: "status_changed" },
        select: { payload: true },
      }),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].payload).toMatchObject({ from: "prospect", to: "member" });
  });

  test("is idempotent — a no-op transition writes no Activity", async () => {
    await changeCompanyStatus(
      fd({ companyId: statusCompanyId, status: "member" }),
    );
    const count = await withOrg(orgA.id, (tx) =>
      tx.activity.count({
        where: { companyId: statusCompanyId, type: "status_changed" },
      }),
    );
    expect(count).toBe(1);
  });

  test("rejects an unknown status", async () => {
    await expect(
      changeCompanyStatus(fd({ companyId: statusCompanyId, status: "vip" })),
    ).rejects.toThrow("invalid company status");
  });

  test("refuses a company id from another tenant and leaves it untouched", async () => {
    await expect(
      changeCompanyStatus(fd({ companyId: companyBId, status: "former" })),
    ).rejects.toThrow("company not found in this organization");

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyBId },
        select: { status: true },
      }),
    );
    expect(companyB!.status).toBe("member");
  });
});

describe("deleteCompany", () => {
  test("permanently removes the company, its contacts, and their introductions/meetings/news/activity", async () => {
    // Seed a self-contained member with the dependents a real profile carries:
    // two contacts, an introduction between them (a RESTRICT FK that would block
    // the contact cascade), a meeting attended by one of them, a news item, and
    // an activity. All of it must be gone after the delete.
    const seeded = await withOrg(orgA.id, async (tx) => {
      const company = await tx.company.create({
        data: {
          orgId: orgA.id,
          name: "Deletable Co",
          status: "member",
          industry: "Manufacturing",
          annualValue: 1000,
          contacts: {
            create: [
              { orgId: orgA.id, name: "First Person", isPrimary: true },
              { orgId: orgA.id, name: "Second Person" },
            ],
          },
        },
        include: { contacts: true },
      });
      const [c1, c2] = company.contacts;

      const intro = await tx.introduction.create({
        data: {
          orgId: orgA.id,
          partyAContactId: c1.id,
          partyBContactId: c2.id,
          status: "suggested",
          source: "manual",
        },
      });
      const meeting = await tx.meeting.create({
        data: { orgId: orgA.id, title: "Kickoff", heldAt: new Date() },
      });
      await tx.meetingAttendee.create({
        data: {
          orgId: orgA.id,
          meetingId: meeting.id,
          contactId: c1.id,
          matchMethod: "manual",
          confidence: 1,
          confirmed: true,
        },
      });
      const news = await tx.newsItem.create({
        data: {
          orgId: orgA.id,
          companyId: company.id,
          headline: "In the news",
          url: `https://news.test/${randomUUID()}`,
          capturedAt: new Date(),
        },
      });
      const activity = await tx.activity.create({
        data: {
          orgId: orgA.id,
          companyId: company.id,
          type: "status_changed",
          payload: { from: null, to: "member" },
          occurredAt: new Date(),
        },
      });
      // A meeting-derived "they owe" item owned by a contact but NOT scoped to the
      // company (no companyId). Its owner_contact_id FK is SET NULL, but the
      // action_items owner-XOR CHECK forbids a row with no owner — so the delete
      // must pre-clear this item rather than let the cascade null it into an
      // invalid state (which would abort the whole transaction).
      const orphanItem = await tx.actionItem.create({
        data: {
          orgId: orgA.id,
          meetingId: meeting.id,
          text: "They owe us documents",
          ownerContactId: c1.id,
          status: "open",
        },
      });
      // A company-scoped item (composite company FK): CASCADE — dies with the firm.
      const scopedItem = await tx.actionItem.create({
        data: {
          orgId: orgA.id,
          companyId: company.id,
          text: "We owe a follow-up",
          ownerUserId: staffUser.id,
          status: "open",
        },
      });
      return {
        companyId: company.id,
        contactIds: [c1.id, c2.id],
        meetingId: meeting.id,
        introId: intro.id,
        newsId: news.id,
        activityId: activity.id,
        orphanItemId: orphanItem.id,
        scopedItemId: scopedItem.id,
      };
    });

    await deleteCompany(fd({ companyId: seeded.companyId }));

    const after = await withOrg(orgA.id, async (tx) => ({
      company: await tx.company.count({ where: { id: seeded.companyId } }),
      contacts: await tx.contact.count({ where: { id: { in: seeded.contactIds } } }),
      intro: await tx.introduction.count({ where: { id: seeded.introId } }),
      attendees: await tx.meetingAttendee.count({
        where: { contactId: { in: seeded.contactIds } },
      }),
      news: await tx.newsItem.count({ where: { id: seeded.newsId } }),
      activity: await tx.activity.count({ where: { id: seeded.activityId } }),
      // The Meeting row itself has no companyId — it is not deleted, only its
      // attendee link is.
      meeting: await tx.meeting.count({ where: { id: seeded.meetingId } }),
      // Both action items are gone: the company-scoped one via the company
      // cascade, the contact-owned one via the up-front pre-clear.
      scopedItem: await tx.actionItem.count({ where: { id: seeded.scopedItemId } }),
      orphanItem: await tx.actionItem.count({ where: { id: seeded.orphanItemId } }),
    }));
    expect(after).toEqual({
      company: 0,
      contacts: 0,
      intro: 0,
      attendees: 0,
      news: 0,
      activity: 0,
      meeting: 1,
      scopedItem: 0,
      orphanItem: 0,
    });

    // Clean up the orphaned meeting so the tenant teardown stays tidy.
    await withOrg(orgA.id, (tx) =>
      tx.meeting.delete({ where: { id: seeded.meetingId } }),
    );
  });

  test("refuses a company id from another tenant and leaves it untouched", async () => {
    await expect(
      deleteCompany(fd({ companyId: companyBId })),
    ).rejects.toThrow("company not found in this organization");

    const companyB = await withOrg(orgB.id, (tx) =>
      tx.company.count({ where: { id: companyBId } }),
    );
    expect(companyB).toBe(1);
  });
});

describe("createCompany", () => {
  test("seeds the status history with the founding status (from: null)", async () => {
    const name = `Seeded Co ${randomUUID()}`;
    await createCompany(fd({ name, status: "prospect", industry: "Manufacturing" }));

    const activities = await withOrg(orgA.id, async (tx) => {
      const c = await tx.company.findFirst({
        where: { name },
        select: { id: true },
      });
      return tx.activity.findMany({
        where: { companyId: c!.id, type: "status_changed" },
        select: { payload: true },
      });
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].payload).toMatchObject({ from: null, to: "prospect" });
  });
});
