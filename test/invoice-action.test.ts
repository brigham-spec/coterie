import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for editInvoice — the edit path that lets a
// member's billing cadence (amount + due/issued dates) be corrected from the
// invoice detail page the company profile links to. Runs against the real Neon
// DB, mocking only Clerk and Next's revalidatePath.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
  requireAdmin: vi.fn(async () => mockCtx),
}));

const { editInvoice, voidInvoice } = await import(
  "@/app/dashboard/invoices/actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };
let companyId = "";
let foreignInvoiceId = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { ...orgA, orgType: "edc" } });
  await prisma.organization.create({ data: { ...orgB, orgType: "edc" } });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;

  companyId = await withOrg(orgA.id, async (tx) => {
    const c = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: `Member ${randomUUID()}`,
        status: "member",
        industry: "Real Estate",
        annualValue: "0",
      },
    });
    return c.id;
  });

  foreignInvoiceId = await withOrg(orgB.id, async (tx) => {
    const c = await tx.company.create({
      data: {
        orgId: orgB.id,
        name: `Foreign ${randomUUID()}`,
        status: "member",
        industry: "Real Estate",
        annualValue: "0",
      },
    });
    const inv = await tx.invoice.create({
      data: {
        orgId: orgB.id,
        companyId: c.id,
        invoiceNumber: `FGN-${randomUUID().slice(0, 8)}`,
        amount: "500",
        issuedOn: new Date("2026-01-01"),
        dueOn: new Date("2026-02-01"),
        status: "sent",
      },
    });
    return inv.id;
  });
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

async function makeInvoice(status = "draft"): Promise<string> {
  const inv = await withOrg(orgA.id, (tx) =>
    tx.invoice.create({
      data: {
        orgId: orgA.id,
        companyId,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        amount: "1000",
        issuedOn: new Date("2026-01-01"),
        dueOn: new Date("2026-02-01"),
        status,
      },
      select: { id: true },
    }),
  );
  return inv.id;
}

describe("editInvoice", () => {
  test("edits the amount, dates, status, and notes", async () => {
    const id = await makeInvoice();
    const result = await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: id,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        amount: "1500.50",
        issuedOn: "2026-03-01",
        dueOn: "2026-04-15",
        status: "sent",
        notes: "Q2 dues, revised",
      }),
    );
    expect(result.status).toBe("saved");
    const updated = await withOrg(orgA.id, (tx) =>
      tx.invoice.findUnique({
        where: { id },
        select: {
          amount: true,
          issuedOn: true,
          dueOn: true,
          status: true,
          notes: true,
        },
      }),
    );
    expect(Number(updated!.amount)).toBe(1500.5);
    expect(updated!.issuedOn.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(updated!.dueOn.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(updated!.status).toBe("sent");
    expect(updated!.notes).toBe("Q2 dues, revised");
  });

  test("clamps an out-of-vocab status to draft", async () => {
    const id = await makeInvoice("sent");
    await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: id,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        amount: "100",
        issuedOn: "2026-01-01",
        dueOn: "2026-02-01",
        status: "paid",
      }),
    );
    const updated = await withOrg(orgA.id, (tx) =>
      tx.invoice.findUnique({ where: { id }, select: { status: true } }),
    );
    expect(updated!.status).toBe("draft");
  });

  test("refuses a negative amount", async () => {
    const id = await makeInvoice();
    const result = await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: id,
        invoiceNumber: "INV-X",
        amount: "-5",
        issuedOn: "2026-01-01",
        dueOn: "2026-02-01",
        status: "draft",
      }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Amount must be a non-negative number.",
    });
  });

  test("refuses to edit a voided invoice", async () => {
    const id = await makeInvoice();
    await voidInvoice(fd({ invoiceId: id }));
    const result = await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: id,
        invoiceNumber: "INV-VOID",
        amount: "100",
        issuedOn: "2026-01-01",
        dueOn: "2026-02-01",
        status: "draft",
      }),
    );
    expect(result).toEqual({
      status: "error",
      message: "A voided invoice can't be edited.",
    });
  });

  test("rejects a duplicate invoice number", async () => {
    const first = `INV-${randomUUID().slice(0, 8)}`;
    await withOrg(orgA.id, (tx) =>
      tx.invoice.create({
        data: {
          orgId: orgA.id,
          companyId,
          invoiceNumber: first,
          amount: "10",
          issuedOn: new Date("2026-01-01"),
          dueOn: new Date("2026-02-01"),
        },
      }),
    );
    const id = await makeInvoice();
    const result = await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: id,
        invoiceNumber: first,
        amount: "100",
        issuedOn: "2026-01-01",
        dueOn: "2026-02-01",
        status: "draft",
      }),
    );
    expect(result).toEqual({
      status: "error",
      message: "That invoice number is already in use.",
    });
  });

  test("cannot edit an invoice from another tenant", async () => {
    const result = await editInvoice(
      { status: "idle" },
      fd({
        invoiceId: foreignInvoiceId,
        invoiceNumber: "INV-HACK",
        amount: "100",
        issuedOn: "2026-01-01",
        dueOn: "2026-02-01",
        status: "draft",
      }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Invoice not found.",
    });
  });
});
