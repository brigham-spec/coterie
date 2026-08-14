import { describe, expect, test } from "vitest";

import {
  findLinkedinHeader,
  linkedinDedupeKey,
  normalizeProfileUrl,
  parseLinkedinCsv,
  parseLinkedinDate,
} from "@/lib/linkedin-csv";

// Pure tests for the LinkedIn export parser. The real export is NOT a plain CSV:
// it opens with a "Notes:" preamble + a blank line before the header, so the
// header-offset handling is the load-bearing part here.

// A faithful slice of a real LinkedIn Connections.csv: preamble, blank spacer,
// then the header and rows (one without a URL, to exercise the name fallback).
const REAL_EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the fields are empty."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://www.linkedin.com/in/ada/,ada@example.com,Analytical Engines,Mathematician,24 Aug 2023
Grace,Hopper,,grace@navy.mil,US Navy,Rear Admiral,03 Jan 2019
`;

describe("findLinkedinHeader", () => {
  test("locates the header past the Notes preamble", () => {
    const cells = [
      ["Notes:"],
      ["When exporting..."],
      [""],
      ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"],
      ["Ada", "Lovelace"],
    ];
    expect(findLinkedinHeader(cells)).toBe(3);
  });

  test("returns -1 when no name columns are present", () => {
    expect(findLinkedinHeader([["Foo", "Bar"], ["1", "2"]])).toBe(-1);
  });
});

describe("parseLinkedinDate", () => {
  test("parses '24 Aug 2023' as a UTC date", () => {
    const d = parseLinkedinDate("24 Aug 2023");
    expect(d?.toISOString()).toBe("2023-08-24T00:00:00.000Z");
  });

  test("accepts a full month name", () => {
    expect(parseLinkedinDate("3 January 2019")?.toISOString()).toBe(
      "2019-01-03T00:00:00.000Z",
    );
  });

  test("returns null for blank or unrecognized input", () => {
    expect(parseLinkedinDate("")).toBeNull();
    expect(parseLinkedinDate("2023-08-24")).toBeNull();
    expect(parseLinkedinDate("32 Aug 2023")).toBeNull();
  });
});

describe("normalizeProfileUrl", () => {
  test("strips scheme, www, query, and trailing slash and lowercases", () => {
    expect(normalizeProfileUrl("https://www.linkedin.com/in/Ada/?trk=x")).toBe(
      "linkedin.com/in/ada",
    );
  });

  test("returns null for blank", () => {
    expect(normalizeProfileUrl("   ")).toBeNull();
  });
});

describe("linkedinDedupeKey", () => {
  test("prefers the normalized profile URL", () => {
    expect(
      linkedinDedupeKey("https://www.linkedin.com/in/Ada/", "Ada Lovelace", "Engines"),
    ).toBe("url:linkedin.com/in/ada");
  });

  test("falls back to name+company when no URL", () => {
    expect(linkedinDedupeKey(null, "Grace  Hopper", "US Navy")).toBe(
      "nc:grace hopper|us navy",
    );
  });

  test("the two url spellings collapse to one key", () => {
    const a = linkedinDedupeKey("http://linkedin.com/in/ada", "Ada", "X");
    const b = linkedinDedupeKey("https://www.linkedin.com/in/ada/", "Ada", "X");
    expect(a).toBe(b);
  });
});

describe("parseLinkedinCsv", () => {
  test("parses a real-shaped export into stated rows", () => {
    const { headerLine, rows, errors } = parseLinkedinCsv(REAL_EXPORT);
    expect(errors).toEqual([]);
    expect(headerLine).toBe(4);
    expect(rows).toHaveLength(2);

    const [ada, grace] = rows;
    expect(ada.fullName).toBe("Ada Lovelace");
    expect(ada.company).toBe("Analytical Engines");
    expect(ada.title).toBe("Mathematician");
    expect(ada.email).toBe("ada@example.com");
    expect(ada.profileUrl).toBe("https://www.linkedin.com/in/ada/");
    expect(ada.dedupeKey).toBe("url:linkedin.com/in/ada");
    expect(ada.connectedOn?.toISOString()).toBe("2023-08-24T00:00:00.000Z");

    // No URL → name+company fallback key.
    expect(grace.profileUrl).toBeNull();
    expect(grace.dedupeKey).toBe("nc:grace hopper|us navy");
  });

  test("lowercases the email", () => {
    const csv = `First Name,Last Name,Email Address\nAda,Lovelace,ADA@EXAMPLE.COM\n`;
    expect(parseLinkedinCsv(csv).rows[0].email).toBe("ada@example.com");
  });

  test("skips blank rows and errors a row with no name", () => {
    const csv = `First Name,Last Name,Company\n\n,,Acme\nAda,Lovelace,Engines\n`;
    const { rows, errors } = parseLinkedinCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Ada Lovelace");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("row has no name");
  });

  test("reports a missing header instead of throwing", () => {
    const { headerLine, rows, errors } = parseLinkedinCsv("just,some,data\n1,2,3\n");
    expect(headerLine).toBeNull();
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
