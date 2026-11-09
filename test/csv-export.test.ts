import { describe, expect, test } from "vitest";

import {
  COMPANY_CSV_HEADERS,
  CONTACT_CSV_HEADERS,
  companyCsvRow,
  contactCsvRow,
  csvAttachmentResponse,
  escapeCsvCell,
  toCsv,
} from "@/lib/csv-export";
import { slugify } from "@/lib/slug";

// Pure unit tests for the CSV export writer + the two domain row mappers. Proves
// RFC-4180 quoting, the column order, and that nullable fields degrade to empty
// cells (never the string "null"/"undefined").
describe("escapeCsvCell", () => {
  test("passes a plain value through unquoted", () => {
    expect(escapeCsvCell("Acme Co")).toBe("Acme Co");
  });

  test("quotes and doubles embedded quotes/commas/newlines", () => {
    expect(escapeCsvCell("Smith, Jr")).toBe('"Smith, Jr"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  test("coerces nullish to empty and numbers to text", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell(1500)).toBe("1500");
  });
});

describe("toCsv", () => {
  test("joins cells with commas and rows with CRLF", () => {
    const csv = toCsv([
      ["Name", "Value"],
      ["Acme", 10],
      ["Globex, Inc", 20],
    ]);
    expect(csv).toBe('Name,Value\r\nAcme,10\r\n"Globex, Inc",20');
  });
});

describe("contactCsvRow", () => {
  test("maps fields in header order with null-safe cells", () => {
    const row = contactCsvRow({
      name: "Jane Doe",
      title: "VP",
      companyName: "Acme",
      email: "jane@acme.com",
      phone: null,
      linkedin: null,
      tags: ["decision_maker", "hnw"],
      isPrimary: true,
    });
    expect(row).toHaveLength(CONTACT_CSV_HEADERS.length);
    expect(row).toEqual([
      "Jane Doe",
      "VP",
      "Acme",
      "jane@acme.com",
      "",
      "",
      "decision_maker; hnw",
      "Yes",
    ]);
  });

  test("renders a non-primary contact as No", () => {
    const row = contactCsvRow({
      name: "Sam",
      title: null,
      companyName: "Globex",
      email: null,
      phone: "555-1234",
      linkedin: "https://linkedin.com/in/sam",
      tags: [],
      isPrimary: false,
    });
    expect(row[7]).toBe("No");
    expect(row[6]).toBe("");
  });
});

describe("companyCsvRow", () => {
  test("maps fields in header order, counties joined, value raw, date as YYYY-MM-DD", () => {
    const row = companyCsvRow({
      name: "Acme",
      status: "Member",
      tier: "Gold",
      industry: "Construction",
      counties: ["Dutchess", "Ulster"],
      annualValue: 12000,
      ownerName: "Beth",
      website: "https://acme.com",
      linkedin: null,
      lastContactAt: new Date("2026-03-15T12:00:00Z"),
      memberSince: 2021,
    });
    expect(row).toHaveLength(COMPANY_CSV_HEADERS.length);
    expect(row).toEqual([
      "Acme",
      "Member",
      "Gold",
      "Construction",
      "Dutchess; Ulster",
      "12000",
      "Beth",
      "https://acme.com",
      "",
      "2026-03-15",
      "2021",
    ]);
  });

  test("blank cells for absent tier / owner / contact / member-since", () => {
    const row = companyCsvRow({
      name: "Prospect Co",
      status: "Prospect",
      tier: null,
      industry: "",
      counties: [],
      annualValue: 0,
      ownerName: null,
      website: null,
      linkedin: null,
      lastContactAt: null,
      memberSince: null,
    });
    expect(row).toEqual([
      "Prospect Co",
      "Prospect",
      "",
      "",
      "",
      "0",
      "",
      "",
      "",
      "",
      "",
    ]);
  });
});

describe("slugify", () => {
  test("lowercases, collapses non-alnum runs, trims, and falls back to org", () => {
    expect(slugify("Hudson Valley EDC")).toBe("hudson-valley-edc");
    expect(slugify("  A&W, Inc.  ")).toBe("a-w-inc");
    expect(slugify("!!!")).toBe("org");
  });
});

describe("csvAttachmentResponse", () => {
  test("prepends a UTF-8 BOM and sets CSV download headers with a dated, slugged filename", async () => {
    const res = csvAttachmentResponse("coterie-companies", "Hudson Valley EDC", "a,b\r\n1,2");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="coterie-companies-hudson-valley-edc-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    // The body bytes lead with the UTF-8 BOM (EF BB BF); Response.text() decodes
    // it away, so assert the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await new Response(bytes.slice(3)).text()).toBe("a,b\r\n1,2");
  });
});
