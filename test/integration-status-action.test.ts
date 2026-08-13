import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { getIntegrationStatus } from "@/lib/integrations";

// Integration test for getIntegrationStatus — the reader that drives the meetings
// Fireflies card's connection state AND the "last sync failed" banner (the column
// added so background sync failures aren't silent). Runs against the real Neon DB.
// Proves it reports connected + a persisted lastSyncError, reports a clean
// connection as null, reports a missing credential as disconnected, and — the
// cardinal rule — that one org can never read another's sync error (RLS silo).

const orgA = { id: randomUUID(), name: `TENANT_A_${randomUUID()}` };
const orgB = { id: randomUUID(), name: `TENANT_B_${randomUUID()}` };

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { ...orgA, orgType: "edc" },
      { ...orgB, orgType: "chamber" },
    ],
  });
  // orgA: a fireflies credential whose last background sync FAILED.
  await withOrg(orgA.id, (tx) =>
    tx.integrationCredential.create({
      data: {
        orgId: orgA.id,
        provider: "fireflies",
        accessTokenEnc: Buffer.from("enc"),
        lastSyncError: "Fireflies rejected your API key. Reconnect with a valid key.",
      },
    }),
  );
  // orgB: a fireflies credential whose last sync is clean (no error).
  await withOrg(orgB.id, (tx) =>
    tx.integrationCredential.create({
      data: {
        orgId: orgB.id,
        provider: "fireflies",
        accessTokenEnc: Buffer.from("enc"),
      },
    }),
  );
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("getIntegrationStatus", () => {
  test("reports connected with the persisted last-sync error", async () => {
    const status = await getIntegrationStatus(orgA.id, "fireflies");
    expect(status.connected).toBe(true);
    expect(status.lastSyncError).toBe(
      "Fireflies rejected your API key. Reconnect with a valid key.",
    );
  });

  test("reports connected with no error for a clean credential", async () => {
    const status = await getIntegrationStatus(orgB.id, "fireflies");
    expect(status.connected).toBe(true);
    expect(status.lastSyncError).toBeNull();
  });

  test("reports disconnected when no credential exists for the provider", async () => {
    const status = await getIntegrationStatus(orgA.id, "gmail");
    expect(status.connected).toBe(false);
    expect(status.lastSyncError).toBeNull();
  });

  test("cannot read another tenant's sync error (RLS silo)", async () => {
    // orgB reading its own fireflies status never surfaces orgA's error; the
    // unique (org_id, provider) is scoped by RLS so the rows never cross.
    const status = await getIntegrationStatus(orgB.id, "fireflies");
    expect(status.lastSyncError).toBeNull();
  });
});
