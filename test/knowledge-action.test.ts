import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for the collateral store (addKnowledgeDoc +
// deleteKnowledgeDoc). Runs against the real Neon DB, mocking only Clerk and
// Next's revalidatePath. Proves a doc is created from pasted text and from a
// plaintext file upload, deletion removes it (and errors when absent), the admin
// gate refuses a non-admin, and — the cardinal rule — the other tenant is sealed.

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

const { addKnowledgeDoc, deleteKnowledgeDoc } = await import(
  "@/app/dashboard/settings/knowledge-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const adminUser = {
  id: randomUUID(),
  clerkId: `clerk_${randomUUID()}`,
  email: `admin_${randomUUID()}@example.com`,
  name: "Admin",
};

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

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userId = adminUser.id;
  mockCtx.role = "admin";
});

afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [orgA.id, orgB.id] } },
  });
  await prisma.user.deleteMany({ where: { id: adminUser.id } });
  await prisma.$disconnect();
});

function pastedForm(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("addKnowledgeDoc", () => {
  test("creates a doc from pasted text", async () => {
    const result = await addKnowledgeDoc(
      { status: "idle" },
      pastedForm({
        kind: "value_prop",
        title: "Why join",
        text: "  We connect founders to capital.\r\n\r\n\r\n\r\nProven results.  ",
      }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.title).toBe("Why join");

    const docs = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.findMany({ where: { title: "Why join" } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("value_prop");
    expect(docs[0].sourceName).toBeNull();
    // CRLF normalized, 4 blank lines collapsed, ends trimmed.
    expect(docs[0].content).toBe(
      "We connect founders to capital.\n\nProven results.",
    );
    expect(docs[0].charCount).toBe(docs[0].content.length);
  });

  test("creates a doc from a plaintext file upload, defaulting the title", async () => {
    const form = new FormData();
    form.set("kind", "sop");
    form.set(
      "file",
      new File(["Step 1. Reach out.\nStep 2. Follow up."], "onboarding-sop.txt", {
        type: "text/plain",
      }),
    );

    const result = await addKnowledgeDoc({ status: "idle" }, form);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.title).toBe("onboarding-sop"); // extension stripped

    const docs = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.findMany({ where: { title: "onboarding-sop" } }),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("sop");
    expect(docs[0].sourceName).toBe("onboarding-sop.txt");
    expect(docs[0].content).toBe("Step 1. Reach out.\nStep 2. Follow up.");
  });

  test("errors when neither a file nor text is provided", async () => {
    const result = await addKnowledgeDoc(
      { status: "idle" },
      pastedForm({ kind: "deck", title: "Empty" }),
    );
    expect(result.status).toBe("error");
  });

  test("errors on an unknown document kind", async () => {
    const result = await addKnowledgeDoc(
      { status: "idle" },
      pastedForm({ kind: "brochure", title: "X", text: "hi" }),
    );
    expect(result.status).toBe("error");
  });
});

describe("deleteKnowledgeDoc", () => {
  test("removes an existing doc", async () => {
    const created = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.create({
        data: {
          orgId: orgA.id,
          kind: "other",
          title: "Disposable",
          content: "gone soon",
          charCount: 9,
        },
      }),
    );

    const form = new FormData();
    form.set("id", created.id);
    const result = await deleteKnowledgeDoc({ status: "idle" }, form);
    expect(result.status).toBe("ok");

    const remaining = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.count({ where: { id: created.id } }),
    );
    expect(remaining).toBe(0);
  });

  test("errors when the doc does not exist", async () => {
    const form = new FormData();
    form.set("id", randomUUID());
    const result = await deleteKnowledgeDoc({ status: "idle" }, form);
    expect(result.status).toBe("error");
  });
});

describe("admin gate", () => {
  test("refuses a non-admin and writes nothing", async () => {
    mockCtx.role = "staff";
    try {
      const before = await withOrg(orgA.id, (tx) => tx.knowledgeDoc.count());
      const result = await addKnowledgeDoc(
        { status: "idle" },
        pastedForm({ kind: "deck", title: "Sneaky", text: "nope" }),
      );
      expect(result.status).toBe("error");
      const after = await withOrg(orgA.id, (tx) => tx.knowledgeDoc.count());
      expect(after).toBe(before);
    } finally {
      mockCtx.role = "admin";
    }
  });
});

describe("tenant isolation", () => {
  test("orgB cannot see or delete orgA's doc", async () => {
    const created = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.create({
        data: {
          orgId: orgA.id,
          kind: "deck",
          title: "Private A",
          content: "orgA only",
          charCount: 9,
        },
      }),
    );

    // orgB's RLS-scoped view never sees it.
    const seenByB = await withOrg(orgB.id, (tx) =>
      tx.knowledgeDoc.count({ where: { id: created.id } }),
    );
    expect(seenByB).toBe(0);

    // A delete issued under orgB removes nothing.
    const deletedByB = await withOrg(orgB.id, (tx) =>
      tx.knowledgeDoc.deleteMany({ where: { id: created.id } }),
    );
    expect(deletedByB.count).toBe(0);

    // Still present for orgA.
    const seenByA = await withOrg(orgA.id, (tx) =>
      tx.knowledgeDoc.count({ where: { id: created.id } }),
    );
    expect(seenByA).toBe(1);
  });
});
