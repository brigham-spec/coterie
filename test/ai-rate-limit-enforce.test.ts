import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import {
  AiRateLimitError,
  enforceAiRateLimit,
  type RateCaps,
} from "@/lib/ai-rate-limit";

// Integration test for enforceAiRateLimit against the real Neon DB — the counter
// upsert runs under withOrg's RLS scope. Small caps (2/minute) make the ceiling
// easy to hit within one fast test run (well under the 60s window). The
// load-bearing assertions: a permitted call is charged and persisted, the cap is
// refused with AiRateLimitError, and one org's spend never draws down another's
// budget (each tenant sees only its own row under RLS).

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

const caps: RateCaps = {
  minuteCap: 2,
  minuteMs: 60_000,
  dayCap: 100,
  dayMs: 86_400_000,
};

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

function counterFor(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx.aiRateLimit.findUnique({
      where: { orgId },
      select: { minuteCount: true, dayCount: true },
    }),
  );
}

describe("enforceAiRateLimit", () => {
  test("charges the first call and opens the counter row", async () => {
    await enforceAiRateLimit(orgA.id, caps);
    expect(await counterFor(orgA.id)).toEqual({ minuteCount: 1, dayCount: 1 });
  });

  test("refuses once the per-minute cap is reached", async () => {
    // Second call reaches the cap of 2 (allowed); the third is refused.
    await enforceAiRateLimit(orgA.id, caps);
    await expect(enforceAiRateLimit(orgA.id, caps)).rejects.toBeInstanceOf(
      AiRateLimitError,
    );
    // The refused call was not charged — the count holds at the cap.
    expect(await counterFor(orgA.id)).toEqual({ minuteCount: 2, dayCount: 2 });
  });

  test("a foreign org's budget is untouched (tenant isolation)", async () => {
    // Org A is capped out, but org B's first call is allowed off its own row.
    await enforceAiRateLimit(orgB.id, caps);
    expect(await counterFor(orgB.id)).toEqual({ minuteCount: 1, dayCount: 1 });
    // Org A's counter did not move.
    expect(await counterFor(orgA.id)).toEqual({ minuteCount: 2, dayCount: 2 });
  });
});
