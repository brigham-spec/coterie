import { describe, expect, test } from "vitest";

import {
  parseCsv,
  normalizeCompanyName,
  mapHeader,
  buildImportRows,
} from "@/lib/csv-import";

// Pure parsing + validation for the bulk importer. No DB — cross-row/DB
// de-duplication is exercised in csv-import-action.test.ts.

describe("parseCsv", () => {
  test("splits simple rows and cells", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("honors quoted fields with embedded commas and newlines", () => {
    const rows = parseCsv('name,note\n"Acme, Inc.","line1\nline2"');
    expect(rows).toEqual([
      ["name", "note"],
      ["Acme, Inc.", "line1\nline2"],
    ]);
  });

  test("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsv('x\n"she said ""hi"""')).toEqual([["x"], ['she said "hi"']]);
  });

  test("treats CRLF as a single line break", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });
});

describe("normalizeCompanyName", () => {
  test("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeCompanyName("  Acme   Capital ")).toBe("acme capital");
    expect(normalizeCompanyName("ACME CAPITAL")).toBe(
      normalizeCompanyName("acme capital"),
    );
  });
});

describe("mapHeader", () => {
  test("locates known columns case-insensitively and ignores unknowns", () => {
    const cols = mapHeader(["Company", "Contact Name", "E-Mail", "junk"]);
    expect(cols.companyName).toBe(0);
    expect(cols.contactName).toBe(1);
    expect(cols.email).toBe(2);
    expect(cols.status).toBeUndefined();
  });
});

const HEADER = "company_name,status,industry,annual_value,contact_name,email";

describe("buildImportRows", () => {
  test("parses valid rows, defaulting status and value", () => {
    const { rows, errors } = buildImportRows(
      parseCsv(`${HEADER}\nAcme,,Finance,,Jane Doe,JANE@acme.com`),
    );
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyName: "Acme",
      status: "prospect",
      industry: "Finance",
      annualValue: "0",
      contactName: "Jane Doe",
      email: "jane@acme.com",
    });
  });

  test("errors when the CSV lacks a company_name column", () => {
    const { rows, errors } = buildImportRows(parseCsv("name,email\nJane,j@x.com"));
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/company_name/);
  });

  test("errors a row missing company_name", () => {
    const { errors } = buildImportRows(parseCsv(`${HEADER}\n,,Finance,,Jane,j@x.com`));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/missing company_name/);
  });

  test("errors a row with neither contact_name nor email", () => {
    const { errors } = buildImportRows(parseCsv(`${HEADER}\nAcme,,Finance,,,`));
    expect(errors[0].message).toMatch(/neither/);
  });

  test("errors an invalid status", () => {
    const { errors } = buildImportRows(
      parseCsv(`${HEADER}\nAcme,vip,Finance,,Jane,j@x.com`),
    );
    expect(errors[0].message).toMatch(/invalid status/);
  });

  test("coerces a formatted annual_value and rejects a negative", () => {
    const ok = buildImportRows(
      parseCsv(`${HEADER}\nAcme,,Finance,"$25,000",Jane,j@x.com`),
    );
    expect(ok.rows[0].annualValue).toBe("25000");

    const bad = buildImportRows(parseCsv(`${HEADER}\nAcme,,Finance,-5,Jane,j@x.com`));
    expect(bad.errors[0].message).toMatch(/invalid annual_value/);
  });

  test("skips fully-blank rows", () => {
    const { rows, errors } = buildImportRows(
      parseCsv(`${HEADER}\nAcme,,Finance,,Jane,j@x.com\n,,,,,`),
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});
