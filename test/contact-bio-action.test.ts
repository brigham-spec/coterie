import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { ContactBioContext } from "@/lib/contact-bio";

// Action-level integration test for the contact-bio flow. Runs against the real
// Neon DB, mocking only two external seams: Clerk (requireOrgContext) and the
// Anthropic engine (generateContactBio). Proves the generate action grounds the
// model in THIS contact's own name/title/company/linkedin (never another
// tenant's), that applyContactBio writes the operator's text into THIS tenant,
// and that both refuse a foreign contact id.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/contact-bio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contact-bio")>();
  return { ...actual, generateContactBio: genSpy };
});

const { generateContactBioAction, applyContactBio } = await import(
  "@/app/dashboard/contacts/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const contactAId = randomUUID();
const companyBId = randomUUID();
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
        status: "member",
        industry: "Manufacturing",
        annualValue: 1000,
      },
    });
    await tx.contact.create({
      data: {
        id: contactAId,
        orgId: orgA.id,
        companyId: companyAId,
        name: "Jane Doe",
        title: "Founder & CEO",
        linkedin: "https://linkedin.com/in/janedoe",
        isPrimary: true,
      },
    });
  });

  // Org B: its own company + contact — must stay invisible to org A's actions.
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
        name: "Bob Beta",
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

beforeEach(() => {
  genSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("generateContactBioAction", () => {
  test("grounds the model in this contact's own facts", async () => {
    genSpy.mockResolvedValue("Jane Doe is the founder of Acme Mills.");

    const state = await generateContactBioAction(
      { status: "idle" },
      fd({ contactId: contactAId }),
    );
    expect(state).toEqual({
      status: "ok",
      bio: "Jane Doe is the founder of Acme Mills.",
    });

    expect(genSpy).toHaveBeenCalledTimes(1);
    const context = genSpy.mock.calls[0][0] as ContactBioContext;
    expect(context.orgName).toBe(orgA.name);
    expect(context.name).toBe("Jane Doe");
    expect(context.title).toBe("Founder & CEO");
    expect(context.company).toBe("Acme Mills");
    expect(context.linkedin).toBe("https://linkedin.com/in/janedoe");
  });

  test("surfaces an empty parse as a 'nothing found' error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await generateContactBioAction(
      { status: "idle" },
      fd({ contactId: contactAId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "No verifiable bio details found on the web.",
    });
  });

  test("refuses a contact id from another tenant (RLS → not found)", async () => {
    const state = await generateContactBioAction(
      { status: "idle" },
      fd({ contactId: contactBId }),
    );
    expect(state).toEqual({
      status: "error",
      message: "contact not found in this organization",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });
});

describe("applyContactBio", () => {
  test("saves the operator's bio to this contact", async () => {
    await applyContactBio(
      fd({ contactId: contactAId, bio: "  Operator-edited bio.  " }),
    );

    const contact = await withOrg(orgA.id, (tx) =>
      tx.contact.findUnique({ where: { id: contactAId }, select: { bio: true } }),
    );
    // Trimmed on save.
    expect(contact!.bio).toBe("Operator-edited bio.");
  });

  test("refuses to write to another tenant's contact (RLS → not found)", async () => {
    await expect(
      applyContactBio(fd({ contactId: contactBId, bio: "leaked" })),
    ).rejects.toThrow("contact not found in this organization");

    const contactB = await withOrg(orgB.id, (tx) =>
      tx.contact.findUnique({ where: { id: contactBId }, select: { bio: true } }),
    );
    expect(contactB!.bio).toBe("");
  });
});
