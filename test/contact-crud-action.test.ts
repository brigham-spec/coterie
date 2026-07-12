import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the P2 contact-CRUD slice (createContact +
// updateContact + removeContact + setPrimaryContact). Runs against the real Neon
// DB, mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves
// the field writes and tag sanitization, that setPrimaryContact promotes one
// contact while demoting the firm's prior primary in the same tx, and — the
// cardinal rule — that every write refuses a foreign id (company on create,
// contact on update/remove/set-primary) via RLS, since contacts.company_id is a
// plain FK whose referential check bypasses tenant scoping.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const { createContact, updateContact, removeContact, setPrimaryContact } =
  await import("@/app/dashboard/contacts/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const companyBId = randomUUID();
// Seeded contacts on company A: existing (edit target) + primary (demote target).
const existingContactId = randomUUID();
const primaryContactId = randomUUID();
// Seeded contact on company B (foreign-refusal target).
const contactBId = randomUUID();

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
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
      },
    });
    await tx.contact.create({
      data: {
        id: existingContactId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Old Name",
        title: "Analyst",
      },
    });
    await tx.contact.create({
      data: {
        id: primaryContactId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Current Primary",
        isPrimary: true,
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
    await tx.contact.create({
      data: {
        id: contactBId,
        orgId: orgB.id,
        companyId: companyBId,
        name: "Beta Person",
        title: "Counsel",
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
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

describe("createContact", () => {
  test("creates a contact under its company, writing details and filtering tags", async () => {
    await createContact(
      fd({
        companyId: companyAId,
        name: "Nora Fields",
        title: "Managing Partner",
        email: "nora@acme.test",
        phone: "555-0101",
        linkedin: "https://linkedin.com/in/nora",
        notes: "Warm intro from the mayor.",
        tags: ["decision_maker", "not_a_real_tag", "hnw"],
      }),
    );

    const created = await withOrg(orgA.id, (tx) =>
      tx.contact.findFirst({
        where: { companyId: companyAId, name: "Nora Fields" },
        select: {
          title: true,
          email: true,
          phone: true,
          linkedin: true,
          notes: true,
          tags: true,
          isPrimary: true,
        },
      }),
    );
    expect(created!.title).toBe("Managing Partner");
    expect(created!.email).toBe("nora@acme.test");
    expect(created!.phone).toBe("555-0101");
    expect(created!.linkedin).toBe("https://linkedin.com/in/nora");
    expect(created!.notes).toBe("Warm intro from the mayor.");
    // Only known contact-tag keys survive.
    expect(created!.tags).toEqual(["decision_maker", "hnw"]);
    expect(created!.isPrimary).toBe(false);
  });

  test("refuses a company id from another tenant", async () => {
    await expect(
      createContact(fd({ companyId: companyBId, name: "Hijacked" })),
    ).rejects.toThrow("company not found in this organization");

    const count = await withOrg(orgB.id, (tx) =>
      tx.contact.count({ where: { companyId: companyBId } }),
    );
    // Only the seeded Beta Person remains — no foreign write landed.
    expect(count).toBe(1);
  });
});

describe("updateContact", () => {
  test("writes the edited fields", async () => {
    await updateContact(
      fd({
        contactId: existingContactId,
        name: "New Name",
        title: "Director",
        email: "new@acme.test",
        tags: ["board_candidate"],
      }),
    );

    const updated = await withOrg(orgA.id, (tx) =>
      tx.contact.findUnique({
        where: { id: existingContactId },
        select: { name: true, title: true, email: true, tags: true },
      }),
    );
    expect(updated!.name).toBe("New Name");
    expect(updated!.title).toBe("Director");
    expect(updated!.email).toBe("new@acme.test");
    expect(updated!.tags).toEqual(["board_candidate"]);
  });

  test("refuses a contact id from another tenant and leaves it untouched", async () => {
    await expect(
      updateContact(fd({ contactId: contactBId, name: "Hijacked" })),
    ).rejects.toThrow("contact not found in this organization");

    const contactB = await withOrg(orgB.id, (tx) =>
      tx.contact.findUnique({
        where: { id: contactBId },
        select: { name: true },
      }),
    );
    expect(contactB!.name).toBe("Beta Person");
  });
});

describe("setPrimaryContact", () => {
  test("promotes the target and demotes the company's prior primary", async () => {
    await setPrimaryContact(fd({ contactId: existingContactId }));

    const contacts = await withOrg(orgA.id, (tx) =>
      tx.contact.findMany({
        where: { companyId: companyAId },
        select: { id: true, isPrimary: true },
      }),
    );
    const byId = new Map(contacts.map((c) => [c.id, c.isPrimary]));
    expect(byId.get(existingContactId)).toBe(true);
    expect(byId.get(primaryContactId)).toBe(false);
    // Exactly one primary remains for the company.
    expect(contacts.filter((c) => c.isPrimary)).toHaveLength(1);
  });

  test("refuses a contact id from another tenant", async () => {
    await expect(
      setPrimaryContact(fd({ contactId: contactBId })),
    ).rejects.toThrow("contact not found in this organization");
  });
});

describe("removeContact", () => {
  test("deletes a contact scoped to the tenant", async () => {
    await removeContact(fd({ contactId: primaryContactId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.contact.findUnique({ where: { id: primaryContactId } }),
    );
    expect(gone).toBeNull();
  });

  test("refuses a contact id from another tenant and leaves it untouched", async () => {
    await expect(
      removeContact(fd({ contactId: contactBId })),
    ).rejects.toThrow("contact not found in this organization");

    const contactB = await withOrg(orgB.id, (tx) =>
      tx.contact.findUnique({ where: { id: contactBId } }),
    );
    expect(contactB).not.toBeNull();
  });
});
