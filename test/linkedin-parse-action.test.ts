import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import type { LinkedInProfile } from "@/lib/linkedin-parse";

// Action-level integration test for the LinkedIn-parse helper (gap-audit cluster
// E). Runs against the real Neon DB, mocking only two external seams: Clerk
// (requireOrgContext) and the Anthropic engine (generateLinkedInProfile). Proves
// the parse action returns the extracted fields, and the create action writes a
// prospect + primary contact into THIS tenant (and only this tenant), deduping
// against an existing company of the same name.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCtx = vi.hoisted(() => ({ orgId: "", orgName: "", userId: "", userName: "" }));
vi.mock("@/lib/auth", () => ({
  requireOrgContext: vi.fn(async () => mockCtx),
}));

const genSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/linkedin-parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/linkedin-parse")>();
  return { ...actual, generateLinkedInProfile: genSpy };
});

const { parseLinkedInProfileAction, createProspectFromLinkedIn } = await import(
  "@/app/dashboard/companies/linkedin-actions"
);

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const profile: LinkedInProfile = {
  name: "Alice Mason",
  org: `Hudson Builders ${randomUUID()}`,
  title: "Principal",
  industry: "Contractor",
  email: "alice@hudsonbuilders.com",
  phone: "555-1234",
  linkedin: "https://linkedin.com/in/alicemason",
  website: "https://hudsonbuilders.com",
  location: "Kingston, NY",
  lookingFor: "capital partners",
  canOffer: "GC services",
  notes: "Third-generation builder.",
};

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  mockCtx.orgId = orgA.id;
  mockCtx.orgName = orgA.name;
  mockCtx.userName = "Brigham Farrand";
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

describe("parseLinkedInProfileAction", () => {
  test("returns the extracted profile from the engine", async () => {
    genSpy.mockResolvedValue(profile);
    const state = await parseLinkedInProfileAction(
      { status: "idle" },
      fd({ profile: "Alice Mason — Principal at Hudson Builders" }),
    );
    expect(state).toEqual({ status: "ok", profile });
    expect(genSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects empty text before any engine call", async () => {
    const state = await parseLinkedInProfileAction(
      { status: "idle" },
      fd({ profile: "   " }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Paste a LinkedIn profile first.",
    });
    expect(genSpy).not.toHaveBeenCalled();
  });

  test("surfaces an unusable parse as an error", async () => {
    genSpy.mockResolvedValue(null);
    const state = await parseLinkedInProfileAction(
      { status: "idle" },
      fd({ profile: "gibberish" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "Could not read a profile from that text. Try again.",
    });
  });
});

describe("createProspectFromLinkedIn", () => {
  test("requires a company name", async () => {
    const state = await createProspectFromLinkedIn(
      { status: "idle" },
      fd({ name: "Nameless", org: "" }),
    );
    expect(state).toEqual({
      status: "error",
      message: "A company name is required to save.",
    });
  });

  test("creates a prospect + primary contact in this tenant only", async () => {
    const state = await createProspectFromLinkedIn(
      { status: "idle" },
      fd({
        org: profile.org,
        name: profile.name,
        title: profile.title,
        industry: profile.industry,
        email: profile.email,
        phone: profile.phone,
        linkedin: profile.linkedin,
        website: profile.website,
        location: profile.location,
        lookingFor: profile.lookingFor,
        canOffer: profile.canOffer,
        notes: profile.notes,
      }),
    );
    expect(state.status).toBe("added");
    if (state.status !== "added") throw new Error("expected added");
    expect(state.companyName).toBe(profile.org);

    const created = await withOrg(orgA.id, (tx) =>
      tx.company.findUnique({
        where: { id: state.companyId },
        include: { contacts: true },
      }),
    );
    expect(created).not.toBeNull();
    expect(created!.status).toBe("prospect");
    expect(created!.source).toBe("LinkedIn");
    expect(created!.industry).toBe("Contractor");
    expect(created!.website).toBe(profile.website);
    expect(created!.counties).toEqual(["Kingston, NY"]);
    expect(created!.lookingFor).toBe("capital partners");
    expect(created!.canOffer).toBe("GC services");
    expect(created!.contacts).toHaveLength(1);
    expect(created!.contacts[0]).toMatchObject({
      name: "Alice Mason",
      email: "alice@hudsonbuilders.com",
      title: "Principal",
      linkedin: "https://linkedin.com/in/alicemason",
      isPrimary: true,
    });

    // Invisible to the other tenant.
    const fromB = await withOrg(orgB.id, (tx) =>
      tx.company.findFirst({ where: { name: { equals: profile.org, mode: "insensitive" } } }),
    );
    expect(fromB).toBeNull();
  });

  test("attaches to an existing company of the same name instead of duplicating", async () => {
    // The prior test already created the company; a second save with the same org
    // name adds a new contact rather than a duplicate company.
    const state = await createProspectFromLinkedIn(
      { status: "idle" },
      fd({ org: profile.org.toUpperCase(), name: "Bob Ridge", email: "bob@hudsonbuilders.com" }),
    );
    expect(state.status).toBe("attached");
    if (state.status !== "attached") throw new Error("expected attached");

    const companies = await withOrg(orgA.id, (tx) =>
      tx.company.findMany({
        where: { name: { equals: profile.org, mode: "insensitive" } },
        include: { contacts: true },
      }),
    );
    expect(companies).toHaveLength(1);
    const names = companies[0].contacts.map((c) => c.name).sort();
    expect(names).toEqual(["Alice Mason", "Bob Ridge"]);
  });
});
