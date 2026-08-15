import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

// Integration test for enrichLinkedinContacts against the real Neon DB, mocking
// only the two external seams: the Anthropic call (generateLinkedinEnrichments) and
// the AI rate limit. The load-bearing assertions: inferred dimensions are written
// with source="inferred" + the graded confidence + enrichedAt stamped; a row the
// model returns nothing for is still STAMPED with null dimensions (honest "no
// basis", not a permanent retry); a second run is a no-op (idempotent, only touches
// enrichedAt:null); hitting the AI cap reports remaining:true and writes nothing;
// and another tenant's rows are never touched (RLS silo).

// importOriginal spread keeps the real LINKEDIN_INFERRED_SOURCE constant live —
// only the paid model call is stubbed.
const generateLinkedinEnrichments = vi.hoisted(() => vi.fn());
vi.mock("@/lib/linkedin-enrich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/linkedin-enrich")>()),
  generateLinkedinEnrichments,
}));

const enforceAiRateLimit = vi.hoisted(() => vi.fn(async () => {}));
class AiRateLimitError extends Error {}
vi.mock("@/lib/ai-rate-limit", () => ({
  enforceAiRateLimit,
  AiRateLimitError,
}));

const { enrichLinkedinContacts } = await import("@/lib/linkedin-enrich-run");

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

// Two connections in orgA (Ada gets classified; Bob gets nothing) plus one in orgB
// to prove isolation. createdAt order (asc) drives the ref index, so seed Ada first.
let adaId: string;
let bobId: string;
let betaId: string;

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });

  await withOrg(orgA.id, async (tx) => {
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgA.id, rowCount: 2 },
      select: { id: true },
    });
    const ada = await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: imp.id,
        dedupeKey: `url:linkedin.com/in/ada-${randomUUID()}`,
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        company: "New Engines",
        title: "Chief Technology Officer",
      },
      select: { id: true },
    });
    adaId = ada.id;
    const bob = await tx.linkedinContact.create({
      data: {
        orgId: orgA.id,
        importId: imp.id,
        dedupeKey: `url:linkedin.com/in/bob-${randomUUID()}`,
        firstName: "Bob",
        lastName: "Nomad",
        fullName: "Bob Nomad",
      },
      select: { id: true },
    });
    bobId = bob.id;
  });

  await withOrg(orgB.id, async (tx) => {
    const imp = await tx.linkedinImport.create({
      data: { orgId: orgB.id, rowCount: 1 },
      select: { id: true },
    });
    const beta = await tx.linkedinContact.create({
      data: {
        orgId: orgB.id,
        importId: imp.id,
        dedupeKey: `url:linkedin.com/in/beta-${randomUUID()}`,
        firstName: "Beta",
        lastName: "Tenant",
        fullName: "Beta Tenant",
        company: "Beta Co",
        title: "Analyst",
      },
      select: { id: true },
    });
    betaId = beta.id;
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function contact(orgId: string, id: string) {
  return withOrg(orgId, (tx) =>
    tx.linkedinContact.findUnique({ where: { id } }),
  );
}

describe("enrichLinkedinContacts", () => {
  test("stamps inferred dimensions + provenance, and stamps a no-basis row too", async () => {
    // Ada (ref "0") is fully classified; Bob (ref "1") the model returns nothing for.
    generateLinkedinEnrichments.mockResolvedValueOnce([
      {
        ref: "0",
        industry: "Software",
        industryConfidence: "high",
        seniority: "C-Suite",
        seniorityConfidence: "high",
        jobFunction: "Executive",
        jobFunctionConfidence: "low",
      },
    ]);

    const result = await enrichLinkedinContacts(orgA.id);
    expect(result).toEqual({ scanned: 2, enriched: 1, remaining: false });

    const ada = await contact(orgA.id, adaId);
    expect(ada?.industry).toBe("Software");
    expect(ada?.industrySource).toBe("inferred");
    expect(ada?.industryConfidence).toBe("high");
    expect(ada?.seniority).toBe("C-Suite");
    expect(ada?.jobFunction).toBe("Executive");
    expect(ada?.jobFunctionConfidence).toBe("low");
    expect(ada?.enrichedAt).not.toBeNull();
    // Geography is deferred to promotion — never inferred here.
    expect(ada?.geography).toBeNull();

    const bob = await contact(orgA.id, bobId);
    expect(bob?.industry).toBeNull();
    expect(bob?.industrySource).toBeNull();
    expect(bob?.industryConfidence).toBeNull();
    // Stamped anyway so it never re-enters the queue.
    expect(bob?.enrichedAt).not.toBeNull();
  });

  test("is a no-op on a second run once everything is enriched", async () => {
    generateLinkedinEnrichments.mockClear();
    const result = await enrichLinkedinContacts(orgA.id);
    expect(result).toEqual({ scanned: 0, enriched: 0, remaining: false });
    // Nothing un-enriched left, so the model is never called.
    expect(generateLinkedinEnrichments).not.toHaveBeenCalled();
  });

  test("leaves the other tenant untouched", async () => {
    const beta = await contact(orgB.id, betaId);
    expect(beta?.industry).toBeNull();
    expect(beta?.enrichedAt).toBeNull();
  });

  test("over the AI cap: reports remaining, writes nothing", async () => {
    // Fresh un-enriched row so there is work to attempt.
    let freshId = "";
    await withOrg(orgA.id, async (tx) => {
      const imp = await tx.linkedinImport.create({
        data: { orgId: orgA.id, rowCount: 1 },
        select: { id: true },
      });
      const fresh = await tx.linkedinContact.create({
        data: {
          orgId: orgA.id,
          importId: imp.id,
          dedupeKey: `url:linkedin.com/in/capped-${randomUUID()}`,
          firstName: "Cap",
          lastName: "Ped",
          fullName: "Cap Ped",
          company: "Capco",
          title: "Manager",
        },
        select: { id: true },
      });
      freshId = fresh.id;
    });

    enforceAiRateLimit.mockRejectedValueOnce(new AiRateLimitError("capped"));
    generateLinkedinEnrichments.mockClear();

    const result = await enrichLinkedinContacts(orgA.id);
    expect(result).toEqual({ scanned: 0, enriched: 0, remaining: true });
    // The model was never called and the row stays un-enriched for the next run.
    expect(generateLinkedinEnrichments).not.toHaveBeenCalled();
    const fresh = await contact(orgA.id, freshId);
    expect(fresh?.enrichedAt).toBeNull();
  });
});
