import { describe, expect, test } from "vitest";

import {
  extractDomain,
  groupConnections,
  inferOrgName,
  inferPersonName,
  isGenericDomain,
  normalizeEmail,
  type ConnectionRow,
} from "@/lib/new-connections";

// Unit tests for the pure New Connections helpers (slice: New Connections
// Detected). No DB / no Fireflies — just the email/domain inference and the
// domain-grouping + ordering rules the sync and dashboard both rely on.

describe("normalizeEmail", () => {
  test("trims and lowercases; tolerates null/undefined", () => {
    expect(normalizeEmail("  Jane.Doe@Acme.COM ")).toBe("jane.doe@acme.com");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("extractDomain", () => {
  test("returns the domain after @, else empty", () => {
    expect(extractDomain("jane@acme.com")).toBe("acme.com");
    expect(extractDomain("  A@Sub.Acme.Com  ")).toBe("sub.acme.com");
    expect(extractDomain("not-an-email")).toBe("");
    expect(extractDomain("")).toBe("");
  });
});

describe("isGenericDomain", () => {
  test("flags personal mailbox providers, not org domains", () => {
    expect(isGenericDomain("gmail.com")).toBe(true);
    expect(isGenericDomain("GMAIL.COM")).toBe(true);
    expect(isGenericDomain("icloud.com")).toBe(true);
    expect(isGenericDomain("comcast.net")).toBe(true);
    expect(isGenericDomain("hudsonvalleypartners.com")).toBe(false);
    expect(isGenericDomain("hvedc.org")).toBe(false);
  });
});

describe("inferPersonName", () => {
  test("title-cases from the email prefix, splitting separators and stripping digits", () => {
    expect(inferPersonName("jane.doe@acme.com")).toBe("Jane Doe");
    expect(inferPersonName("jane_doe-smith@acme.com")).toBe("Jane Doe Smith");
    expect(inferPersonName("jdoe2024@acme.com")).toBe("Jdoe");
    expect(inferPersonName("info+sales@acme.com")).toBe("Info Sales");
  });
});

describe("inferOrgName", () => {
  test("splits compound domain words and title-cases", () => {
    expect(inferOrgName("hudsonvalleypartners.com")).toBe("Hudsonvalley Partners");
    expect(inferOrgName("summitcapital.com")).toBe("Summit Capital");
  });

  test("uppercases short / all-consonant tokens as acronyms", () => {
    expect(inferOrgName("hvcb.org")).toBe("HVCB"); // all consonants
    expect(inferOrgName("llc.com")).toBe("LLC");
    expect(inferOrgName("occ.org")).toBe("OCC"); // <= 3 chars
  });

  test("empty domain -> empty string", () => {
    expect(inferOrgName("")).toBe("");
    expect(inferOrgName(".com")).toBe("");
  });
});

describe("groupConnections", () => {
  function row(over: Partial<ConnectionRow>): ConnectionRow {
    return {
      id: over.id ?? "id",
      email: over.email ?? "x@acme.com",
      domain: over.domain ?? "acme.com",
      inferredName: over.inferredName ?? null,
      inferredOrg: over.inferredOrg ?? null,
      seenCount: over.seenCount ?? 1,
      lastMeetingTitle: over.lastMeetingTitle ?? null,
    };
  }

  test("groups by domain and orders people by seenCount desc then email", () => {
    const groups = groupConnections([
      row({ id: "1", email: "b@acme.com", domain: "acme.com", seenCount: 1 }),
      row({ id: "2", email: "a@acme.com", domain: "acme.com", seenCount: 3 }),
      row({ id: "3", email: "c@acme.com", domain: "acme.com", seenCount: 1 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].domain).toBe("acme.com");
    expect(groups[0].totalSeen).toBe(5);
    expect(groups[0].people.map((p) => p.id)).toEqual(["2", "1", "3"]);
  });

  test("prefers a stored inferredOrg, falling back to inferOrgName(domain)", () => {
    const withStored = groupConnections([
      row({ domain: "acme.com", inferredOrg: "Acme Holdings" }),
    ]);
    expect(withStored[0].orgName).toBe("Acme Holdings");

    const withoutStored = groupConnections([
      row({ domain: "summitcapital.com", inferredOrg: null }),
    ]);
    expect(withoutStored[0].orgName).toBe("Summit Capital");
  });

  test("orders groups by totalSeen desc, then group size, then org name", () => {
    const groups = groupConnections([
      row({ id: "a1", email: "a@alpha.com", domain: "alpha.com", seenCount: 2 }),
      row({ id: "b1", email: "b@beta.com", domain: "beta.com", seenCount: 5 }),
      row({ id: "c1", email: "c@gamma.com", domain: "gamma.com", seenCount: 1 }),
      row({ id: "c2", email: "d@gamma.com", domain: "gamma.com", seenCount: 1 }),
    ]);

    // beta (5) first; alpha (2) and gamma (2) tie on totalSeen, gamma has 2
    // people so it outranks alpha.
    expect(groups.map((g) => g.domain)).toEqual(["beta.com", "gamma.com", "alpha.com"]);
  });

  test("empty input -> empty array", () => {
    expect(groupConnections([])).toEqual([]);
  });
});
