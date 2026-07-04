import { describe, it, expect } from "vitest";

import {
  matchAttendee,
  CONFIRM_THRESHOLD,
  type MatchContact,
  type MatchCompany,
} from "@/lib/attendee-match";

// Unit test for the Fireflies attendee -> contact matcher (build item 6, spec
// §3.10). Pure logic, no DB. Verifies the descending signal priority and that
// only exact-email matches auto-confirm.

const contacts: MatchContact[] = [
  { id: "c-ana", name: "Ana Reyes", email: "ana@acme.com", companyId: "acme" },
  { id: "c-ben", name: "Ben Stone", email: "ben@acme.com", companyId: "acme" },
  { id: "c-cid", name: "Cid Vale", email: null, companyId: "solo" },
];

const companies: MatchCompany[] = [
  { id: "acme", emailDomain: "acme.com" },
  { id: "solo", emailDomain: "solo.io" },
];

describe("attendee matching", () => {
  it("matches by exact email at confidence 1 (auto-confirmed)", () => {
    const m = matchAttendee(
      { email: "ANA@acme.com", displayName: null, name: null },
      contacts,
      companies,
    );
    expect(m).toEqual({
      contactId: "c-ana",
      matchMethod: "email",
      confidence: 1,
    });
    expect(m!.confidence >= CONFIRM_THRESHOLD).toBe(true);
  });

  it("matches by unambiguous full display name below the confirm threshold", () => {
    const m = matchAttendee(
      { email: null, displayName: "Ben Stone", name: null },
      contacts,
      companies,
    );
    expect(m).toEqual({
      contactId: "c-ben",
      matchMethod: "display_name",
      confidence: 0.6,
    });
    expect(m!.confidence >= CONFIRM_THRESHOLD).toBe(false);
  });

  it("matches by domain only when the company has exactly one contact", () => {
    const solo = matchAttendee(
      { email: "unknown@solo.io", displayName: null, name: null },
      contacts,
      companies,
    );
    expect(solo).toEqual({
      contactId: "c-cid",
      matchMethod: "domain",
      confidence: 0.5,
    });

    // acme.com has two contacts -> ambiguous -> no domain match
    const acme = matchAttendee(
      { email: "unknown@acme.com", displayName: null, name: null },
      contacts,
      companies,
    );
    expect(acme).toBeNull();
  });

  it("falls back to a unique surname as the weakest signal", () => {
    const m = matchAttendee(
      { email: null, displayName: "Bennett Stone", name: null },
      contacts,
      companies,
    );
    expect(m).toEqual({
      contactId: "c-ben",
      matchMethod: "surname",
      confidence: 0.3,
    });
  });

  it("prefers a stronger signal when several could apply", () => {
    // Email is exact AND the name matches — email must win.
    const m = matchAttendee(
      { email: "ben@acme.com", displayName: "Ben Stone", name: null },
      contacts,
      companies,
    );
    expect(m!.matchMethod).toBe("email");
  });

  it("returns null for a stranger", () => {
    const m = matchAttendee(
      { email: "nobody@elsewhere.com", displayName: "Zed Nobody", name: null },
      contacts,
      companies,
    );
    expect(m).toBeNull();
  });
});
