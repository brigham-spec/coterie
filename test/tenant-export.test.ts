import { describe, expect, it } from "vitest";

import { EXPORT_TABLE_NAMES, EXPORT_VERSION } from "@/lib/tenant-export";

// The export's table list is a security surface: it must carry the org's own
// content but NEVER the sensitive/identity/cache tables. These assertions lock
// the exclusions in place so a future table addition can't silently leak
// secrets into a downloadable file.

describe("tenant export table set", () => {
  it("covers core tenant content tables", () => {
    for (const name of ["companies", "contacts", "introductions", "invoices"]) {
      expect(EXPORT_TABLE_NAMES).toContain(name);
    }
  });

  it("excludes identity, secrets, caches, and UI-overlay state", () => {
    const forbidden = [
      "organizations",
      "users",
      "orgMemberships",
      "integrationCredentials",
      "aiRateLimits",
      "proactiveScanCaches",
      "unmatchedAttendees",
      "agendaItemStates",
      "introDismissals",
      "prospectDismissals",
    ];
    for (const name of forbidden) {
      expect(EXPORT_TABLE_NAMES).not.toContain(name);
    }
  });

  it("lists each table only once", () => {
    expect(new Set(EXPORT_TABLE_NAMES).size).toBe(EXPORT_TABLE_NAMES.length);
  });

  it("carries a stable version stamp", () => {
    expect(EXPORT_VERSION).toBe(1);
  });
});
