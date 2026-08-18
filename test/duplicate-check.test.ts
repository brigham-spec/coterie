import { describe, expect, it } from "vitest";

import {
  findCompanyDuplicate,
  findContactDuplicate,
  normalizeName,
  type ExistingCompany,
  type ExistingContact,
} from "@/lib/duplicate-check";

describe("normalizeName", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeName("  Acme  Corp ")).toBe("acme corp");
    expect(normalizeName("ACME corp")).toBe("acme corp");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("")).toBe("");
  });
});

describe("findCompanyDuplicate", () => {
  const existing: ExistingCompany[] = [
    { id: "a", name: "Acme Corp" },
    { id: "b", name: "Globex" },
  ];

  it("matches case- and whitespace-insensitively", () => {
    expect(findCompanyDuplicate("  acme   corp ", existing)?.id).toBe("a");
  });

  it("returns null when there is no match", () => {
    expect(findCompanyDuplicate("Initech", existing)).toBeNull();
  });

  it("matches a longer qualified variant of an existing name", () => {
    const dbi: ExistingCompany[] = [
      { id: "d", name: "DBI" },
      { id: "p", name: "DBI Projects" },
    ];
    // "DBI Projects Test" contains the words of both — flags the first match.
    expect(findCompanyDuplicate("DBI Projects Test", dbi)).not.toBeNull();
  });

  it("matches when the new name is a shorter subset of an existing one", () => {
    const dbi: ExistingCompany[] = [{ id: "p", name: "DBI Projects Test" }];
    expect(findCompanyDuplicate("DBI", dbi)?.id).toBe("p");
  });

  it("does not match on a merely overlapping but non-subset name", () => {
    expect(findCompanyDuplicate("Acme Global", existing)).toBeNull();
  });

  it("returns null for a blank name", () => {
    expect(findCompanyDuplicate("   ", existing)).toBeNull();
  });
});

describe("findContactDuplicate", () => {
  const existing: ExistingContact[] = [
    {
      id: "1",
      name: "Jane Doe",
      companyId: "acme",
      email: "jane@acme.com",
      companyName: "Acme",
    },
    {
      id: "2",
      name: "John Smith",
      companyId: "globex",
      email: null,
      companyName: "Globex",
    },
  ];

  it("matches by email anywhere in the org, even a different company", () => {
    const match = findContactDuplicate(
      { name: "Totally Different", companyId: "globex", email: "JANE@acme.com" },
      existing,
    );
    expect(match?.id).toBe("1");
  });

  it("matches by name at the same company when no email match", () => {
    const match = findContactDuplicate(
      { name: "  john   smith ", companyId: "globex", email: null },
      existing,
    );
    expect(match?.id).toBe("2");
  });

  it("does not match the same name at a different company", () => {
    const match = findContactDuplicate(
      { name: "John Smith", companyId: "acme", email: null },
      existing,
    );
    expect(match).toBeNull();
  });

  it("matches a qualified variant of a name at the same company", () => {
    const match = findContactDuplicate(
      { name: "John Smith Test", companyId: "globex", email: null },
      existing,
    );
    expect(match?.id).toBe("2");
  });

  it("returns null for a blank name with no email", () => {
    expect(
      findContactDuplicate({ name: "   ", companyId: "acme", email: null }, existing),
    ).toBeNull();
  });
});
