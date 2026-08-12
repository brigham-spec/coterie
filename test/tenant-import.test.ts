import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import {
  exportTenantData,
  EXPORT_TABLE_NAMES,
  EXPORT_VERSION,
} from "@/lib/tenant-export";
import { importTenantData, IMPORT_TABLE_NAMES } from "@/lib/tenant-import";

// Round-trip integration test against the real dev DB. Seeds a source org with
// the awkward cases — a self-referential company referral, a platform-user FK, a
// Fireflies sync key, a composite-PK junction, and a self-referential invoice
// schedule — exports it, then restores into a fresh empty org. Because ids are
// regenerated, assertions match on stable business keys (names / numbers) and
// verify the remapped references line up.

const source = { id: randomUUID(), name: `SRC_${randomUUID()}` };
const target = { id: randomUUID(), name: `DST_${randomUUID()}` };
const ownerUser = {
  id: randomUUID(),
  clerkId: `user_${randomUUID()}`,
  email: `${randomUUID()}@example.test`,
  name: "Owner",
};

const companyA = randomUUID();
const companyB = randomUUID();
const firefliesId = `ff_${randomUUID()}`;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...source, orgType: "edc" },
      { ...target, orgType: "edc" },
    ],
  });
  await prisma.user.create({ data: ownerUser });

  await withOrg(source.id, async (tx) => {
    await tx.company.create({
      data: {
        id: companyA,
        orgId: source.id,
        name: "Company A",
        status: "member",
        industry: "tech",
        annualValue: "1000.00",
        ownerUserId: ownerUser.id,
      },
    });
    await tx.company.create({
      data: {
        id: companyB,
        orgId: source.id,
        name: "Company B",
        status: "prospect",
        industry: "finance",
        annualValue: "0.00",
        referredById: companyA,
      },
    });
    const alice = await tx.contact.create({
      data: { orgId: source.id, companyId: companyA, name: "Alice" },
    });
    await tx.contact.create({
      data: { orgId: source.id, companyId: companyB, name: "Bob" },
    });

    const meeting = await tx.meeting.create({
      data: { orgId: source.id, title: "Kickoff", heldAt: new Date(), firefliesId },
    });
    await tx.meetingAttendee.create({
      data: {
        orgId: source.id,
        meetingId: meeting.id,
        contactId: alice.id,
        matchMethod: "manual",
        confidence: 1,
      },
    });

    const parent = await tx.invoice.create({
      data: {
        orgId: source.id,
        companyId: companyA,
        invoiceNumber: "INV-1",
        amount: "100.00",
        issuedOn: new Date(),
        dueOn: new Date(),
      },
    });
    await tx.invoice.create({
      data: {
        orgId: source.id,
        companyId: companyA,
        invoiceNumber: "INV-2",
        amount: "50.00",
        issuedOn: new Date(),
        dueOn: new Date(),
        parentInvoiceId: parent.id,
      },
    });
    await tx.payment.create({
      data: {
        orgId: source.id,
        invoiceId: parent.id,
        amount: "50.00",
        receivedOn: new Date(),
      },
    });
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [source.id, target.id] } },
  });
  await prisma.user.delete({ where: { id: ownerUser.id } });
  await prisma.$disconnect();
});

describe("importTenantData", () => {
  test("import table set matches the export's", () => {
    // Both files must describe the same tenant content — no table restored that
    // wasn't exported, and none exported that the restore silently drops. Assert
    // against the export's own list so the two can't drift.
    expect(new Set(IMPORT_TABLE_NAMES)).toEqual(new Set(EXPORT_TABLE_NAMES));
  });

  test("restores the graph into a fresh org with remapped ids", async () => {
    const snapshot = await exportTenantData(source.id, source.name);
    const summary = await importTenantData(target.id, snapshot);

    expect(summary.imported.companies).toBe(2);
    expect(summary.imported.contacts).toBe(2);
    expect(summary.imported.meetings).toBe(1);
    expect(summary.imported.meetingAttendees).toBe(1);
    expect(summary.imported.invoices).toBe(2);
    expect(summary.imported.payments).toBe(1);

    const restored = await withOrg(target.id, async (tx) => ({
      companies: await tx.company.findMany(),
      contacts: await tx.contact.findMany(),
      meetings: await tx.meeting.findMany(),
      attendees: await tx.meetingAttendee.findMany(),
      invoices: await tx.invoice.findMany(),
      payments: await tx.payment.findMany(),
    }));

    // Every restored row belongs to the target org, and none reuses a source id.
    const sourceIds = new Set<string>([companyA, companyB]);
    for (const row of [...restored.companies, ...restored.contacts]) {
      expect(row.orgId).toBe(target.id);
    }
    for (const c of restored.companies) expect(sourceIds.has(c.id)).toBe(false);

    const a = restored.companies.find((c) => c.name === "Company A");
    const b = restored.companies.find((c) => c.name === "Company B");
    // Platform-user FK nulled (users are not part of an export).
    expect(a?.ownerUserId).toBeNull();
    // Self-reference restored, pointing at the NEW id of company A.
    expect(b?.referredById).toBe(a?.id);

    // Fireflies sync key dropped; composite-PK attendee remapped to new ids.
    expect(restored.meetings[0].firefliesId).toBeNull();
    const alice = restored.contacts.find((c) => c.name === "Alice");
    expect(restored.attendees[0].meetingId).toBe(restored.meetings[0].id);
    expect(restored.attendees[0].contactId).toBe(alice?.id);

    // Invoice schedule self-reference remapped to the new parent id.
    const parent = restored.invoices.find((i) => i.invoiceNumber === "INV-1");
    const child = restored.invoices.find((i) => i.invoiceNumber === "INV-2");
    expect(child?.parentInvoiceId).toBe(parent?.id);
    expect(restored.payments[0].invoiceId).toBe(parent?.id);
  });

  test("refuses to restore into a non-empty org", async () => {
    const snapshot = await exportTenantData(source.id, source.name);
    // target now holds the rows from the previous test.
    await expect(importTenantData(target.id, snapshot)).rejects.toThrow(
      /not empty/,
    );
  });

  test("rejects an export from an unsupported version", async () => {
    const snapshot = await exportTenantData(source.id, source.name);
    const bad = { ...snapshot, version: EXPORT_VERSION + 1 };
    await expect(importTenantData(randomUUID(), bad)).rejects.toThrow(
      /unsupported export version/,
    );
  });
});
