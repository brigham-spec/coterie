import { describe, expect, test } from "vitest";

import { filterContacts, type ContactFilter } from "@/lib/contact-list";

// Pure unit tests for the shared contacts-list filter that both the page and the
// CSV export run, so the download can never drift from the view.

type Row = {
  name: string;
  title: string | null;
  email: string | null;
  companyId: string;
  companyName: string;
  companyStatus: string;
  tags: string[];
  isPrimary: boolean;
};

function contact(overrides: Partial<Row> = {}): Row {
  return {
    name: "Jane Doe",
    title: null,
    email: null,
    companyId: "c1",
    companyName: "Acme",
    companyStatus: "member",
    tags: [],
    isPrimary: false,
    ...overrides,
  };
}

const NO_FILTER: ContactFilter = {
  segment: "all",
  q: "",
  company: "",
  tag: "",
  primaryOnly: false,
};

describe("filterContacts", () => {
  const rows = [
    contact({ name: "Alice Smith", title: "CEO", email: "alice@acme.com", companyId: "c1", companyName: "Acme Build", companyStatus: "member", tags: ["decision_maker"], isPrimary: true }),
    contact({ name: "Bob Jones", title: "Analyst", email: "bob@globex.com", companyId: "c2", companyName: "Globex", companyStatus: "prospect", tags: ["hnw"] }),
    contact({ name: "Carol King", title: "CFO", email: "carol@initech.com", companyId: "c3", companyName: "Initech", companyStatus: "former" }),
  ];

  test("no filter returns everything", () => {
    expect(filterContacts(rows, NO_FILTER)).toHaveLength(3);
  });

  test("segment narrows by the contact's company status", () => {
    const out = filterContacts(rows, { ...NO_FILTER, segment: "prospects" });
    expect(out.map((c) => c.name)).toEqual(["Bob Jones"]);
  });

  test("an unknown segment key falls back to All", () => {
    expect(filterContacts(rows, { ...NO_FILTER, segment: "bogus" })).toHaveLength(3);
  });

  test("q matches name, title, email, or company, case-insensitively", () => {
    expect(filterContacts(rows, { ...NO_FILTER, q: "alice" }).map((c) => c.name)).toEqual(["Alice Smith"]);
    expect(filterContacts(rows, { ...NO_FILTER, q: "cfo" }).map((c) => c.name)).toEqual(["Carol King"]);
    expect(filterContacts(rows, { ...NO_FILTER, q: "globex" }).map((c) => c.name)).toEqual(["Bob Jones"]);
    expect(filterContacts(rows, { ...NO_FILTER, q: "initech.com" }).map((c) => c.name)).toEqual(["Carol King"]);
  });

  test("company narrows to one firm's contacts", () => {
    expect(filterContacts(rows, { ...NO_FILTER, company: "c2" }).map((c) => c.name)).toEqual(["Bob Jones"]);
  });

  test("tag narrows by membership", () => {
    expect(filterContacts(rows, { ...NO_FILTER, tag: "decision_maker" }).map((c) => c.name)).toEqual(["Alice Smith"]);
  });

  test("primaryOnly keeps only primary contacts", () => {
    expect(filterContacts(rows, { ...NO_FILTER, primaryOnly: true }).map((c) => c.name)).toEqual(["Alice Smith"]);
  });
});
