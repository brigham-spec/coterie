import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the LinkedIn importer (previewImport +
// commitImport). Runs against the real Neon DB, mocking only Clerk and Next's
// revalidatePath. Proves that preview classifies new / update / duplicate rows
// without writing; that commit creates new people, UPDATES an existing person
// (refreshing stated fields + repointing importId) while PRESERVING prior
// enrichment (enrichedAt + inferred dimensions); that within-file repeats
// collapse to one row; that the admin gate refuses a non-admin; and — the
// cardinal rule — that the other tenant is untouched.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({
  orgId: "",
  orgName: "",
  userId: "",
  userName: "",
  userEmail: "",
  role: "admin",
}));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { previewImport, commitImport } = await import(
  "@/app/dashboard/linkedin/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const adminUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `admin_${randomUUID()}@example.com`,
  name: "Admin",
};

// Ada is already imported AND enriched; Grace appears twice in the file (new +
// a within-file repeat). Ada's row carries fresh stated values so we can prove
// the update refreshes stated fields but keeps the enrichment.
const CSV = `Notes:

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://www.linkedin.com/in/ada/,ada@new.com,New Engines,Senior Mathematician,24 Aug 2023
Grace,Hopper,https://www.linkedin.com/in/grace/,grace@navy.mil,US Navy,Rear Admiral,03 Jan 2019
Grace,Hopper,https://www.linkedin.com/in/grace/,grace2@navy.mil,US Navy,Admiral,05 Jan 2019`;

const ADA_KEY = "url:linkedin.com/in/ada";
const GRACE_KEY = "url:linkedin.com/in/grace";

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  await prisma.user.create({ data: adminUser });
  await prisma.orgMembership.create({
    data: { orgId: orgA.id, userId: adminUser.id, role: "admin" },
  });

  // Seed orgA with a prior import + an already-enriched Ada.
  await withOrg(orgA.id, async (tx) => {
    const priorImport = await tx.linkedinImport.create({
      data: { orgId: orgA.id, rowCount: 1, fileName: "old.csv" },
      select: { id: true },
    });
    await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: priorImport.id,
        dedupeKey: ADA_KEY,
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        company: "Old Engines",
        title: "Junior Mathematician",
        profileUrl: "https://www.linkedin.com/in/ada/",
        email: "ada@old.com",
        industry: "Software",
        industrySource: "inferred",
        industryConfidence: "high",
        enrichedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
  });

  // orgB gets its own enriched-but-unrelated import to prove isolation.
  await withOrg(orgB.id, async (tx) => {
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgB.id, rowCount: 1 },
      select: { id: true },
    });
    await tx.linkedinContact.create({
      data: {
        orgId: orgB.id,
        importId: imp.id,
        dedupeKey: ADA_KEY,
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        company: "Beta Engines",
      },
    });
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = adminUser.id;
  mockCtx.userEmail = adminUser.email;
  mockCtx.role = "admin";
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: adminUser.id } });
  await prisma.$disconnect();
});

function csvForm(text: string, extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("csv", text);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

describe("previewImport", () => {
  test("classifies new / update / duplicate without writing", async () => {
    const before = await withOrg(orgA.id, (tx) => tx.linkedinContact.count());

    const preview = await previewImport({ status: "idle" }, csvForm(CSV));
    expect(preview.status).toBe("ok");
    if (preview.status !== "ok") return;

    expect(preview.counts).toMatchObject({
      personsNew: 1, // Grace
      personsUpdate: 1, // Ada (already imported)
      rowsDuplicate: 1, // Grace's second row
      rowErrors: 0,
    });

    const after = await withOrg(orgA.id, (tx) => tx.linkedinContact.count());
    expect(after).toBe(before); // no writes
  });

  test("errors on empty input", async () => {
    const preview = await previewImport({ status: "idle" }, csvForm("  "));
    expect(preview.status).toBe("error");
  });

  test("surfaces a no-name row as an error without counting it as a person", async () => {
    const csv = `First Name,Last Name,URL,Company\n,,https://linkedin.com/in/ghost/,Nowhere\nZed,Zephyr,https://linkedin.com/in/zed/,Somewhere`;
    const preview = await previewImport({ status: "idle" }, csvForm(csv));
    expect(preview.status).toBe("ok");
    if (preview.status !== "ok") return;

    expect(preview.counts).toMatchObject({ personsNew: 1, rowErrors: 1 });
    const errorRow = preview.sample.find((r) => r.state === "error");
    expect(errorRow?.error).toBe("row has no name");
  });
});

describe("commitImport", () => {
  test("creates the new person, updates + preserves enrichment on the existing one", async () => {
    const result = await commitImport(
      { status: "idle" },
      csvForm(CSV, { fileName: "connections.csv", exportedOn: "2026-08-10" }),
    );
    expect(result).toEqual({ status: "ok", created: 1, updated: 1 });

    const state = await withOrg(orgA.id, async (tx) => {
      const ada = await tx.linkedinContact.findUnique({
        where: { orgId_dedupeKey: { orgId: orgA.id, dedupeKey: ADA_KEY } },
      });
      const grace = await tx.linkedinContact.findUnique({
        where: { orgId_dedupeKey: { orgId: orgA.id, dedupeKey: GRACE_KEY } },
      });
      const total = await tx.linkedinContact.count();
      const newImport = await tx.linkedinImport.findFirst({
        where: { fileName: "connections.csv" },
      });
      return { ada, grace, total, newImport };
    });

    // Exactly two people — the within-file Grace repeat collapsed to one row.
    expect(state.total).toBe(2);

    // The new snapshot-of-record carries the operator-supplied export date,
    // the importing user, and the DEDUPED row count (not the raw row count).
    expect(state.newImport).not.toBeNull();
    expect(state.newImport?.exportedOn?.toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
    expect(state.newImport?.importedByUserId).toBe(adminUser.id);
    expect(state.newImport?.rowCount).toBe(2); // Grace's repeat collapsed

    // Ada: stated fields refreshed + repointed at the new import...
    expect(state.ada?.company).toBe("New Engines");
    expect(state.ada?.title).toBe("Senior Mathematician");
    expect(state.ada?.email).toBe("ada@new.com");
    expect(state.ada?.importId).toBe(state.newImport?.id);
    // ...but prior enrichment is untouched.
    expect(state.ada?.industry).toBe("Software");
    expect(state.ada?.industrySource).toBe("inferred");
    expect(state.ada?.enrichedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // Grace: created un-enriched (last-occurrence stated values win).
    expect(state.grace?.email).toBe("grace2@navy.mil");
    expect(state.grace?.title).toBe("Admiral");
    expect(state.grace?.enrichedAt).toBeNull();
    expect(state.grace?.industry).toBeNull();
  });

  test("leaves the other tenant untouched", async () => {
    const beta = await withOrg(orgB.id, async (tx) => ({
      total: await tx.linkedinContact.count(),
      ada: await tx.linkedinContact.findUnique({
        where: { orgId_dedupeKey: { orgId: orgB.id, dedupeKey: ADA_KEY } },
      }),
    }));
    expect(beta.total).toBe(1);
    expect(beta.ada?.company).toBe("Beta Engines"); // not overwritten by orgA's import
  });
});

describe("admin gate", () => {
  test("refuses a non-admin and writes nothing", async () => {
    mockCtx.role = "staff";
    try {
      const before = await withOrg(orgA.id, (tx) => tx.linkedinContact.count());
      const preview = await previewImport({ status: "idle" }, csvForm(CSV));
      expect(preview.status).toBe("error");
      const result = await commitImport({ status: "idle" }, csvForm(CSV));
      expect(result.status).toBe("error");
      const after = await withOrg(orgA.id, (tx) => tx.linkedinContact.count());
      expect(after).toBe(before);
    } finally {
      mockCtx.role = "admin";
    }
  });
});
