import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the company-document persistence slice
// (applyDocumentIntel + deleteCompanyDocument). Runs against the real Neon DB,
// mocking only Clerk (requireOrgContext) and Next's revalidatePath. Proves the
// analyzed-document summary is persisted (so it stays visible after a refresh),
// that a summary can be saved even when no profile fields are checked, that a
// foreign company id is an RLS no-op, and that a row delete is tenant-scoped.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { applyDocumentIntel, deleteCompanyDocument } = await import(
  "@/app/dashboard/companies/[id]/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const companyAId = randomUUID();
const companyBId = randomUUID();

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
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("applyDocumentIntel", () => {
  test("persists the document summary and applies checked fields", async () => {
    const state = await applyDocumentIntel(
      { status: "idle" },
      fd({
        companyId: companyAId,
        fileName: "offering-memo.pdf",
        docSummary: "A $5M raise for a cold-storage expansion.",
        intel: JSON.stringify({ lookingFor: "Capital for cold storage" }),
      }),
    );
    expect(state).toEqual({ status: "applied", count: 1 });

    const doc = await withOrg(orgA.id, (tx) =>
      tx.companyDocument.findFirst({
        where: { companyId: companyAId, fileName: "offering-memo.pdf" },
        select: { summary: true },
      }),
    );
    expect(doc!.summary).toBe("A $5M raise for a cold-storage expansion.");

    const company = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: companyAId },
        select: { lookingFor: true },
      }),
    );
    expect(company!.lookingFor).toBe("Capital for cold storage");
  });

  test("saves a document summary even when no profile fields are checked", async () => {
    const state = await applyDocumentIntel(
      { status: "idle" },
      fd({
        companyId: companyAId,
        fileName: "pitch-deck.pdf",
        docSummary: "A pitch deck.",
        intel: JSON.stringify({}),
      }),
    );
    expect(state).toEqual({ status: "applied", count: 0 });

    const doc = await withOrg(orgA.id, (tx) =>
      tx.companyDocument.findFirst({
        where: { companyId: companyAId, fileName: "pitch-deck.pdf" },
        select: { summary: true },
      }),
    );
    expect(doc!.summary).toBe("A pitch deck.");
  });

  test("refuses a company id from another tenant (RLS → not found)", async () => {
    const state = await applyDocumentIntel(
      { status: "idle" },
      fd({
        companyId: companyBId,
        fileName: "leak.pdf",
        docSummary: "leaked",
        intel: JSON.stringify({}),
      }),
    );
    expect(state).toEqual({
      status: "error",
      message: "company not found in this organization",
    });

    const count = await withOrg(orgB.id, (tx) =>
      tx.companyDocument.count({ where: { companyId: companyBId } }),
    );
    expect(count).toBe(0);
  });
});

describe("deleteCompanyDocument", () => {
  test("deletes a document row scoped to the tenant", async () => {
    const documentId = randomUUID();
    await withOrg(orgA.id, (tx) =>
      tx.companyDocument.create({
        data: {
          id: documentId,
          orgId: orgA.id,
          companyId: companyAId,
          fileName: "disposable.pdf",
          summary: "throwaway",
        },
      }),
    );

    await deleteCompanyDocument(fd({ documentId, companyId: companyAId }));

    const gone = await withOrg(orgA.id, (tx) =>
      tx.companyDocument.findUnique({ where: { id: documentId } }),
    );
    expect(gone).toBeNull();
  });

  test("a foreign document id is a no-op (RLS 0-row)", async () => {
    const foreignId = randomUUID();
    await withOrg(orgB.id, (tx) =>
      tx.companyDocument.create({
        data: {
          id: foreignId,
          orgId: orgB.id,
          companyId: companyBId,
          fileName: "beta.pdf",
          summary: "beta's doc",
        },
      }),
    );

    await deleteCompanyDocument(fd({ documentId: foreignId, companyId: companyAId }));

    const still = await withOrg(orgB.id, (tx) =>
      tx.companyDocument.findUnique({ where: { id: foreignId } }),
    );
    expect(still).not.toBeNull();
  });
});
