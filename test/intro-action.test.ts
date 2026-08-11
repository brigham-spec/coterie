import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the S8d inline profile intro management
// (createIntroduction + updateIntroduction + deleteIntroduction, reused from the
// introductions feature). Runs against the real Neon DB, mocking only Clerk
// (requireOrgContext) and Next's revalidatePath. Proves the manual create with
// stage/connection validation and the distinct-parties guard, the stage advance
// + outcome set/clear, that a foreign contact/intro id is refused by RLS, and
// that deleting an intro SetNulls (not cascades) any linked value entry.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { createIntroduction, updateIntroduction, deleteIntroduction } =
  await import("@/app/dashboard/introductions/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const staffUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `staff_${randomUUID()}@example.com`,
  name: "Staff Member",
};

const companyAId = randomUUID();
const companyBId = randomUUID();
// Contacts anchor the introductions (two parties each).
const contactA1 = randomUUID();
const contactA2 = randomUUID();
const contactB1 = randomUUID();
const contactB2 = randomUUID();
// A seeded orgB intro — the foreign target for the update/delete-refusal tests.
const introBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: staffUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: staffUser.id, role: "staff" },
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
    await tx.contact.createMany({
      data: [
        { id: contactA1, orgId: orgA.id, companyId: companyAId, name: "Ada A" },
        { id: contactA2, orgId: orgA.id, companyId: companyAId, name: "Ben A" },
      ],
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
    await tx.contact.createMany({
      data: [
        { id: contactB1, orgId: orgB.id, companyId: companyBId, name: "Cal B" },
        { id: contactB2, orgId: orgB.id, companyId: companyBId, name: "Dot B" },
      ],
    });
    await tx.introduction.create({
      data: {
        id: introBId,
        orgId: orgB.id,
        partyAContactId: contactB1,
        partyBContactId: contactB2,
        status: "made",
        source: "manual",
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = staffUser.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createIntroduction", () => {
  test("logs a manual intro between two contacts", async () => {
    await createIntroduction(
      fd({
        companyId: companyAId,
        partyAContactId: contactA1,
        partyBContactId: contactA2,
        status: "made",
        madeOn: "2026-06-01",
        headline: "Introduced Ada to Ben.",
      }),
    );

    const intro = await withOrg(orgA.id, (tx) =>
      tx.introduction.findFirst({
        where: { partyAContactId: contactA1, partyBContactId: contactA2 },
        select: {
          status: true,
          source: true,
          headline: true,
          madeOn: true,
          connectionType: true,
        },
      }),
    );
    expect(intro!.status).toBe("made");
    expect(intro!.source).toBe("manual");
    expect(intro!.headline).toBe("Introduced Ada to Ben.");
    expect(intro!.madeOn?.toISOString().slice(0, 10)).toBe("2026-06-01");
    // Omitted connection type is stored as the empty default, not rejected.
    expect(intro!.connectionType).toBe("");
  });

  test("rejects an invalid stage", async () => {
    await expect(
      createIntroduction(
        fd({
          partyAContactId: contactA1,
          partyBContactId: contactA2,
          status: "not_a_stage",
        }),
      ),
    ).rejects.toThrow("invalid introduction status");
  });

  test("rejects the same contact for both parties", async () => {
    await expect(
      createIntroduction(
        fd({
          partyAContactId: contactA1,
          partyBContactId: contactA1,
          status: "made",
        }),
      ),
    ).rejects.toThrow("the two parties must be different contacts");
  });

  test("refuses a contact id from another tenant", async () => {
    await expect(
      createIntroduction(
        fd({
          partyAContactId: contactA1,
          partyBContactId: contactB1,
          status: "made",
        }),
      ),
    ).rejects.toThrow("contact not found in this organization");

    const count = await withOrg(orgA.id, (tx) =>
      tx.introduction.count({ where: { partyBContactId: contactB1 } }),
    );
    expect(count).toBe(0);
  });
});

describe("updateIntroduction", () => {
  test("advances the stage and sets, then clears, the outcome", async () => {
    const introId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.introduction.create({
        data: {
          id: introId,
          orgId: orgA.id,
          partyAContactId: contactA1,
          partyBContactId: contactA2,
          status: "made",
          source: "manual",
        },
      }),
    );

    await updateIntroduction(
      fd({ introId, status: "connected", outcome: "They met and hit it off." }),
    );
    const advanced = await withOrg(orgA.id, (tx) =>
      tx.introduction.findUnique({
        where: { id: introId },
        select: { status: true, outcome: true },
      }),
    );
    expect(advanced!.status).toBe("connected");
    expect(advanced!.outcome).toBe("They met and hit it off.");

    // An emptied outcome clears the stored field back to null.
    await updateIntroduction(fd({ introId, status: "collaborating", outcome: "" }));
    const cleared = await withOrg(orgA.id, (tx) =>
      tx.introduction.findUnique({
        where: { id: introId },
        select: { status: true, outcome: true },
      }),
    );
    expect(cleared!.status).toBe("collaborating");
    expect(cleared!.outcome).toBeNull();
  });

  test("refuses an intro id from another tenant and leaves it untouched", async () => {
    await expect(
      updateIntroduction(fd({ introId: introBId, status: "dormant" })),
    ).rejects.toThrow("introduction not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.introduction.findUnique({
        where: { id: introBId },
        select: { status: true },
      }),
    );
    expect(still!.status).toBe("made");
  });
});

describe("deleteIntroduction", () => {
  test("deletes an intro and SetNulls a linked value entry", async () => {
    const introId = randomUUID();
    const valueId = randomUUID();
    await withOrg(orgA.id, async (tx) => {
      await tx.introduction.create({
        data: {
          id: introId,
          orgId: orgA.id,
          partyAContactId: contactA1,
          partyBContactId: contactA2,
          status: "made",
          source: "manual",
        },
      });
      await tx.valueDelivered.create({
        data: {
          id: valueId,
          orgId: orgA.id,
          companyId: companyAId,
          introductionId: introId,
          kind: "introduction",
          summary: "A win from this intro.",
          occurredAt: new Date("2026-03-01"),
        },
      });
    });

    await deleteIntroduction(fd({ introId, companyId: companyAId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.introduction.findUnique({ where: { id: introId } }),
    );
    expect(gone).toBeNull();

    // The linked value survives; only its introduction FK is nulled.
    const value = await withOrg(orgA.id, (tx) =>
      tx.valueDelivered.findUnique({
        where: { id: valueId },
        select: { introductionId: true },
      }),
    );
    expect(value).not.toBeNull();
    expect(value!.introductionId).toBeNull();
  });

  test("refuses an intro id from another tenant and leaves it untouched", async () => {
    await expect(
      deleteIntroduction(fd({ introId: introBId })),
    ).rejects.toThrow("introduction not found in this organization");

    const still = await withOrg(orgB.id, (tx) =>
      tx.introduction.findUnique({ where: { id: introBId } }),
    );
    expect(still).not.toBeNull();
  });
});
