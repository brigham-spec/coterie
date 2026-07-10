import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Action-level integration test for Email Intelligence (slice 11.12). Exercises
// the server actions against the real Neon DB, mocking only the external seam —
// the Google-Sheet fetch. Proves syncEmails lands each analysed row in the
// caller's tenant, matches known senders to their company while leaving strangers
// unmatched, upserts (never duplicates) on re-sync, refuses a non-Google URL
// before ever fetching, and keeps rows invisible to another tenant (RLS).

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email-sync", () => ({ fetchEmailCsv: fetchSpy }));

const { syncEmails, deleteEmailMessage } = await import("@/app/dashboard/email/actions");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/abc/pub?output=csv";

const HEADER =
  "date,from_name,from_email,subject,member_match,org_match,summary,projects,action_items,sentiment,thread_id";

const CSV = [
  HEADER,
  "03/01/2026,Pat Rivera,pat@riverside.example,Re: mill financing,Pat Rivera,Riverside Mills,Closing soon.,Mill Redevelopment,Send draft; Book call,positive,em-1",
  "03/02/2026,A Stranger,stranger@unknown.example,Cold outreach,,,,,,neutral,em-2",
].join("\n");

let companyAId = "";

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    const company = await tx.company.create({
      data: {
        orgId: orgA.id,
        name: "Riverside Mills",
        status: "member",
        industry: "Developer",
        annualValue: 1000,
        contacts: {
          create: {
            orgId: orgA.id,
            name: "Pat Rivera",
            email: "pat@riverside.example",
            isPrimary: true,
          },
        },
      },
    });
    companyAId = company.id;
  });

  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  fetchSpy.mockReset();
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("syncEmails action", () => {
  test("ingests rows, matches known senders, upserts on re-sync", async () => {
    fetchSpy.mockResolvedValue(CSV);

    const state = await syncEmails({ status: "idle" }, fd({ sheetUrl: SHEET_URL }));
    expect(state).toEqual({ status: "ok", synced: 2, matched: 1, unmatched: 1 });
    expect(fetchSpy).toHaveBeenCalledWith(SHEET_URL);

    const stored = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({ orderBy: { externalKey: "asc" } }),
    );
    expect(stored.map((e) => e.externalKey)).toEqual(["em-1", "em-2"]);

    const matched = stored.find((e) => e.externalKey === "em-1");
    expect(matched?.companyId).toBe(companyAId);
    expect(matched?.subject).toBe("Re: mill financing");
    expect(matched?.sentiment).toBe("positive");

    const stranger = stored.find((e) => e.externalKey === "em-2");
    expect(stranger?.companyId).toBeNull();

    // Re-syncing the same externalKey updates in place — no duplicate row.
    fetchSpy.mockResolvedValue(
      [HEADER, "03/01/2026,Pat Rivera,pat@riverside.example,Re: mill financing (v2),Pat Rivera,Riverside Mills,Signed.,Mill Redevelopment,,positive,em-1"].join(
        "\n",
      ),
    );
    const again = await syncEmails({ status: "idle" }, fd({ sheetUrl: SHEET_URL }));
    expect(again).toEqual({ status: "ok", synced: 1, matched: 1, unmatched: 0 });

    const afterResync = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findMany({ orderBy: { externalKey: "asc" } }),
    );
    expect(afterResync).toHaveLength(2);
    expect(afterResync.find((e) => e.externalKey === "em-1")?.subject).toBe(
      "Re: mill financing (v2)",
    );
  });

  test("refuses a URL that isn't a published Google Sheet (never fetches)", async () => {
    const empty = await syncEmails({ status: "idle" }, fd({ sheetUrl: "" }));
    expect(empty).toEqual({
      status: "error",
      message: "Paste your published Google Sheets CSV URL first.",
    });

    const foreign = await syncEmails(
      { status: "idle" },
      fd({ sheetUrl: "https://evil.example/pub?output=csv" }),
    );
    expect(foreign.status).toBe("error");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("surfaces a fetch failure as inline error state", async () => {
    fetchSpy.mockRejectedValue(new Error("boom"));
    const state = await syncEmails({ status: "idle" }, fd({ sheetUrl: SHEET_URL }));
    expect(state).toEqual({
      status: "error",
      message: "Could not read the sheet. Confirm it's published to the web as CSV.",
    });
  });
});

describe("tenant isolation", () => {
  test("synced emails are invisible to another tenant (RLS), then delete scopes", async () => {
    const seenByB = await withOrg(orgB.id, (tx) => tx.emailMessage.findMany());
    expect(seenByB).toEqual([]);

    const stranger = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.findFirst({ where: { externalKey: "em-2" } }),
    );
    // orgB cannot delete orgA's row (RLS makes deleteMany a no-op there).
    mockCtx.orgId = orgB.id;
    await deleteEmailMessage(fd({ id: stranger!.id }));
    mockCtx.orgId = orgA.id;

    const stillThere = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.count({ where: { externalKey: "em-2" } }),
    );
    expect(stillThere).toBe(1);

    // Its owner can.
    await deleteEmailMessage(fd({ id: stranger!.id }));
    const gone = await withOrg(orgA.id, (tx) =>
      tx.emailMessage.count({ where: { externalKey: "em-2" } }),
    );
    expect(gone).toBe(0);
  });
});
