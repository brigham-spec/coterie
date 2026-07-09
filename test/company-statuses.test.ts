import { describe, it, expect } from "vitest";

import {
  COMPANY_STATUS_DEFS,
  COMPANY_STATUSES,
  NETWORK_STATUSES,
  isCompanyStatus,
} from "@/lib/company-statuses";

// Unit test for the canonical company lifecycle vocabulary. Pure logic, no DB.
// Guards the status set the form select, segment tabs, and write-boundary
// validation all speak through.

describe("company status vocabulary", () => {
  it("defines the four canonical statuses", () => {
    expect(COMPANY_STATUSES).toEqual([
      "prospect",
      "member",
      "strategic_partner",
      "former",
    ]);
    expect(COMPANY_STATUS_DEFS.map((s) => s.label)).toEqual([
      "Prospect",
      "Member",
      "Strategic Partner",
      "Former",
    ]);
  });

  it("marks members and strategic partners as in-network", () => {
    expect([...NETWORK_STATUSES]).toEqual(["member", "strategic_partner"]);
    expect(NETWORK_STATUSES).not.toContain("prospect");
    expect(NETWORK_STATUSES).not.toContain("former");
  });

  it("validates status membership for the write boundary", () => {
    expect(isCompanyStatus("prospect")).toBe(true);
    expect(isCompanyStatus("strategic_partner")).toBe(true);
    expect(isCompanyStatus("mystery")).toBe(false);
    expect(isCompanyStatus("")).toBe(false);
  });
});
