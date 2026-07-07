import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Two seeded fake tenants. Every assertion here defends CLAUDE.md cardinal rule
// #1/#3: no query path may return one tenant's data in another tenant's context.
const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

let companyAId: string;
let companyBId: string;

const baseCompany = { status: "member", industry: "test", annualValue: 1000 };

beforeAll(async () => {
  // organizations is platform-level (no RLS), so seed the tenants directly.
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  companyAId = (
    await withOrg(orgA.id, (tx) =>
      tx.company.create({ data: { orgId: orgA.id, name: "Acme (A)", ...baseCompany } }),
    )
  ).id;

  companyBId = (
    await withOrg(orgB.id, (tx) =>
      tx.company.create({ data: { orgId: orgB.id, name: "Beta (B)", ...baseCompany } }),
    )
  ).id;
});

afterAll(async () => {
  // Cascade-deletes each tenant's rows; DELETE cascades bypass RLS.
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("tenant isolation (RLS)", () => {
  test("a tenant sees only its own rows via list queries", async () => {
    const seenByA = await withOrg(orgA.id, (tx) => tx.company.findMany());
    const seenByB = await withOrg(orgB.id, (tx) => tx.company.findMany());

    expect(seenByA.map((c) => c.id)).toContain(companyAId);
    expect(seenByA.map((c) => c.id)).not.toContain(companyBId);
    expect(seenByB.map((c) => c.id)).toContain(companyBId);
    expect(seenByB.map((c) => c.id)).not.toContain(companyAId);
  });

  test("a tenant cannot read another tenant's row by id", async () => {
    const crossRead = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({ where: { id: companyBId } }),
    );
    expect(crossRead).toBeNull();
  });

  test("a tenant cannot write a row stamped with another org_id (WITH CHECK)", async () => {
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.company.create({ data: { orgId: orgB.id, name: "smuggled", ...baseCompany } }),
      ),
    ).rejects.toThrow();
  });

  test("the org-less client is fail-closed: no context, no rows", async () => {
    // Bare prisma has no app.org_id set, so RLS returns nothing at all.
    const rows = await prisma.company.findMany({
      where: { id: { in: [companyAId, companyBId] } },
    });
    expect(rows).toEqual([]);
  });
});

describe("tenant isolation (composite FKs)", () => {
  test("a junction row cannot join parents from different orgs", async () => {
    const projectAId = (
      await withOrg(orgA.id, (tx) =>
        tx.project.create({ data: { orgId: orgA.id, name: "Project (A)", stage: "open" } }),
      )
    ).id;

    // Link A's project to B's company. Even stamped with org A, the composite FK
    // (company_id, org_id) -> companies(id, org_id) has no matching parent row.
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.projectLink.create({
          data: { orgId: orgA.id, projectId: projectAId, companyId: companyBId, role: "advisor" },
        }),
      ),
    ).rejects.toThrow();
  });
});

// Slice 11.0 — the three new tenant tables must uphold the same guarantees.
describe("tenant isolation (slice 11.0 tables)", () => {
  test("events: RLS scopes lists, cross-reads, and WITH CHECK writes", async () => {
    const eventAId = (
      await withOrg(orgA.id, (tx) =>
        tx.event.create({ data: { orgId: orgA.id, name: "Dinner (A)", type: "member_dinner" } }),
      )
    ).id;

    const seenByB = await withOrg(orgB.id, (tx) => tx.event.findMany());
    expect(seenByB.map((e) => e.id)).not.toContain(eventAId);

    const crossRead = await withOrg(orgB.id, (tx) =>
      tx.event.findUnique({ where: { id: eventAId } }),
    );
    expect(crossRead).toBeNull();

    // Cannot stamp a row with another org's id (WITH CHECK).
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.event.create({ data: { orgId: orgB.id, name: "smuggled", type: "other" } }),
      ),
    ).rejects.toThrow();

    // Bare (org-less) client sees nothing — fail-closed.
    const bare = await prisma.event.findMany({ where: { id: eventAId } });
    expect(bare).toEqual([]);
  });

  test("event_invitees: composite FK forbids an event from another org", async () => {
    const eventAId = (
      await withOrg(orgA.id, (tx) =>
        tx.event.create({ data: { orgId: orgA.id, name: "Panel (A)", type: "panel" } }),
      )
    ).id;

    // Org B tries to invite a guest to org A's event. The composite FK
    // (event_id, org_id) -> events(id, org_id) has no matching parent in B's scope.
    await expect(
      withOrg(orgB.id, (tx) =>
        tx.eventInvitee.create({
          data: { orgId: orgB.id, eventId: eventAId, externalName: "smuggled" },
        }),
      ),
    ).rejects.toThrow();
  });

  test("membership_proposals: composite FK forbids a company from another org", async () => {
    // Org A proposes membership to org B's company. The composite FK
    // (company_id, org_id) -> companies(id, org_id) has no matching parent row.
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.membershipProposal.create({
          data: { orgId: orgA.id, companyId: companyBId, tier: "Director Level" },
        }),
      ),
    ).rejects.toThrow();
  });
});
