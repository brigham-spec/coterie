import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for New Connections Detected. Exercises the
// triage actions against the real Neon DB (RLS on), mocking only Clerk. Proves:
//   • promoteConnection creates a prospect + primary contact, then removes the row;
//   • promoteConnection attaches to an EXISTING company (no duplicate) when the
//     inferred org name already exists;
//   • attachConnection adds a contact to a chosen company;
//   • dismissConnection sets a durable dismissedAt;
//   • a foreign tenant's row id is refused (RLS -> not found), and its rows stay
//     invisible / untouched.

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { promoteConnection, attachConnection, dismissConnection, dismissConnectionDomain } =
  await import("@/app/dashboard/new-connections-actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

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

async function seedRow(
  orgId: string,
  over: Partial<{
    email: string;
    domain: string;
    inferredName: string | null;
    inferredOrg: string | null;
    lastMeetingTitle: string | null;
  }> = {},
): Promise<string> {
  return withOrg(orgId, async (tx) => {
    const r = await tx.unmatchedAttendee.create({
      data: {
        orgId,
        email: over.email ?? `person-${randomUUID()}@acme.com`,
        domain: over.domain ?? "acme.com",
        inferredName: over.inferredName ?? "Jane Doe",
        inferredOrg: over.inferredOrg ?? "Acme Holdings",
        lastMeetingTitle: over.lastMeetingTitle ?? "Q3 planning sync",
        meetingIds: [],
      },
      select: { id: true },
    });
    return r.id;
  });
}

describe("promoteConnection", () => {
  test("creates a new prospect with a primary contact, then removes the row", async () => {
    const email = `founder-${randomUUID()}@newco-ventures.com`;
    const id = await seedRow(orgA.id, {
      email,
      domain: "newco-ventures.com",
      inferredOrg: "NewCo Ventures",
      inferredName: "Sam Reed",
    });

    const result = await promoteConnection(id);
    expect(result.status).toBe("promoted");

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findFirst({
        where: { name: "NewCo Ventures" },
        include: { contacts: true },
      }),
    );
    expect(company?.status).toBe("prospect");
    expect(company?.source).toBe("Fireflies");
    expect(company?.emailDomain).toBe("newco-ventures.com");
    expect(company?.contacts).toHaveLength(1);
    expect(company?.contacts[0]).toMatchObject({
      name: "Sam Reed",
      email,
      isPrimary: true,
    });

    const gone = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
  });

  test("attaches to an existing company when the inferred org already exists", async () => {
    const existing = await withOrg(orgA.id, (tx) =>
      tx.company.create({
        data: { orgId: orgA.id, name: "Existing Corp", status: "member", industry: "Legal", annualValue: "0" },
        select: { id: true },
      }),
    );

    const email = `contact-${randomUUID()}@existingcorp.com`;
    const id = await seedRow(orgA.id, {
      email,
      domain: "existingcorp.com",
      inferredOrg: "Existing Corp",
      inferredName: "Pat Lee",
    });

    const result = await promoteConnection(id);
    expect(result).toEqual({ status: "attached", companyId: existing.id });

    const contacts = await withOrg(orgA.id, (tx) =>
      tx.contact.findMany({ where: { companyId: existing.id } }),
    );
    expect(contacts.map((c) => c.email)).toContain(email);

    const gone = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
  });
});

describe("attachConnection", () => {
  test("adds the person as a contact on the chosen company and removes the row", async () => {
    const company = await withOrg(orgA.id, (tx) =>
      tx.company.create({
        data: { orgId: orgA.id, name: "Target Co", status: "member", industry: "Other", annualValue: "0" },
        select: { id: true },
      }),
    );

    const email = `attach-${randomUUID()}@some-org.com`;
    const id = await seedRow(orgA.id, { email, domain: "some-org.com" });

    const result = await attachConnection(id, company.id);
    expect(result).toEqual({ status: "attached", companyId: company.id });

    const contacts = await withOrg(orgA.id, (tx) =>
      tx.contact.findMany({ where: { companyId: company.id } }),
    );
    expect(contacts.map((c) => c.email)).toContain(email);

    const gone = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findUnique({ where: { id } }),
    );
    expect(gone).toBeNull();
  });
});

describe("dismissConnection", () => {
  test("sets a durable dismissedAt without deleting the row", async () => {
    const id = await seedRow(orgA.id);

    const result = await dismissConnection(id);
    expect(result).toEqual({ status: "dismissed" });

    const row = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findUnique({ where: { id }, select: { dismissedAt: true } }),
    );
    expect(row?.dismissedAt).toBeInstanceOf(Date);
  });

  test("dismissConnectionDomain waves off every current row at a domain", async () => {
    const domain = `dismiss-${randomUUID()}.com`;
    await seedRow(orgA.id, { email: `a@${domain}`, domain });
    await seedRow(orgA.id, { email: `b@${domain}`, domain });

    const result = await dismissConnectionDomain(domain);
    expect(result).toEqual({ status: "dismissed" });

    const rows = await withOrg(orgA.id, (tx) =>
      tx.unmatchedAttendee.findMany({ where: { domain } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dismissedAt !== null)).toBe(true);
  });
});

describe("cross-tenant isolation", () => {
  test("a foreign tenant's row id is refused and its rows stay untouched", async () => {
    const foreignId = await seedRow(orgB.id, {
      email: `foreign-${randomUUID()}@bravo.com`,
      domain: "bravo.com",
    });

    // Caller is orgA; RLS hides orgB's row -> action reports not found, no create.
    const result = await promoteConnection(foreignId);
    expect(result).toEqual({ status: "error", message: "Not found." });

    // orgB's row is intact and never promoted.
    const stillThere = await withOrg(orgB.id, (tx) =>
      tx.unmatchedAttendee.findUnique({ where: { id: foreignId } }),
    );
    expect(stillThere).not.toBeNull();
    expect(stillThere?.dismissedAt).toBeNull();

    // No "Bravo" company leaked into either tenant.
    const inA = await withOrg(orgA.id, (tx) =>
      tx.company.findMany({ where: { emailDomain: "bravo.com" } }),
    );
    expect(inA).toEqual([]);
  });
});
