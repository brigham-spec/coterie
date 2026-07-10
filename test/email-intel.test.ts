import { describe, expect, test } from "vitest";

import {
  isPublishedSheetUrl,
  matchEmailToCompany,
  parseEmailSheet,
  type EmailRow,
  type MatchCompany,
} from "@/lib/email-intel";

// Pure-logic tests for Email Intelligence: the CSV parser must survive quoting,
// embedded commas/newlines, header casing, blank + duplicate rows; the matcher
// must assign an email to at most one company in a deterministic priority order;
// and the URL guard must only trust docs.google.com over https.

const HEADER =
  "date,from_name,from_email,subject,member_match,org_match,summary,projects,action_items,sentiment,thread_id";

describe("parseEmailSheet", () => {
  test("parses a clean row and maps every column", () => {
    const csv = [
      HEADER,
      "03/01/2026,Pat Rivera,pat@riverside.example,Re: mill,Pat Rivera,Riverside Mills,Closing soon.,Mill Redevelopment,Send draft; Book call,positive,t-1",
    ].join("\n");
    expect(parseEmailSheet(csv)).toEqual([
      {
        externalKey: "t-1",
        emailDate: "03/01/2026",
        fromName: "Pat Rivera",
        fromEmail: "pat@riverside.example",
        subject: "Re: mill",
        memberMatch: "Pat Rivera",
        orgMatch: "Riverside Mills",
        summary: "Closing soon.",
        projects: "Mill Redevelopment",
        actionItems: "Send draft; Book call",
        sentiment: "positive",
      },
    ]);
  });

  test("handles quoted fields with commas and embedded newlines", () => {
    const csv =
      'date,from_email,subject,summary,thread_id\n03/02/2026,x@a.example,"Hello, world","Line one\nLine two",t-2';
    const rows = parseEmailSheet(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Hello, world");
    expect(rows[0].summary).toBe("Line one\nLine two");
    expect(rows[0].externalKey).toBe("t-2");
  });

  test("normalizes messy headers and unescapes doubled quotes", () => {
    const csv =
      'Date, From Email ,Subject,Thread ID\r\n03/03/2026,y@b.example,"She said ""hi""",t-3';
    const rows = parseEmailSheet(csv);
    expect(rows[0].fromEmail).toBe("y@b.example");
    expect(rows[0].subject).toBe('She said "hi"');
    expect(rows[0].externalKey).toBe("t-3");
  });

  test("drops fully-blank rows and de-dupes by externalKey", () => {
    const csv = [
      HEADER,
      "03/04/2026,,keep@a.example,Kept,,,,,,,t-4",
      ",,,,,,,,,,",
      "03/04/2026,,keep@a.example,Kept again,,,,,,,t-4",
    ].join("\n");
    const rows = parseEmailSheet(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Kept");
  });

  test("falls back to date+from_email when there is no thread_id", () => {
    const csv = "date,from_email,subject\n03/05/2026,z@c.example,Hi";
    expect(parseEmailSheet(csv)[0].externalKey).toBe("03/05/2026_z@c.example");
  });

  test("returns [] for empty or header-only input", () => {
    expect(parseEmailSheet("")).toEqual([]);
    expect(parseEmailSheet("date,from_email,subject")).toEqual([]);
  });
});

function row(over: Partial<EmailRow>): EmailRow {
  return {
    externalKey: "k",
    emailDate: "",
    fromName: "",
    fromEmail: "",
    subject: "",
    memberMatch: "",
    orgMatch: "",
    summary: "",
    projects: "",
    actionItems: "",
    sentiment: "",
    ...over,
  };
}

describe("matchEmailToCompany", () => {
  const companies: MatchCompany[] = [
    {
      id: "c1",
      name: "Riverside Mills",
      contactEmails: ["pat@riverside.example"],
      contactNames: ["Pat Rivera"],
    },
    {
      id: "c2",
      name: "Acme Holdings",
      contactEmails: [],
      contactNames: ["Jane Doe"],
    },
  ];

  test("matches on an exact contact email", () => {
    expect(matchEmailToCompany(row({ fromEmail: "PAT@riverside.example" }), companies)).toBe(
      "c1",
    );
  });

  test("matches a distinctive company-name word in the sender address", () => {
    expect(matchEmailToCompany(row({ fromEmail: "info@riverside.co" }), companies)).toBe("c1");
  });

  test("matches a company-name word in Claude's guessed org", () => {
    expect(
      matchEmailToCompany(row({ orgMatch: "Acme Holdings LLC" }), companies),
    ).toBe("c2");
  });

  test("matches a contact name word in Claude's guessed contact", () => {
    expect(matchEmailToCompany(row({ memberMatch: "spoke with Jane today" }), companies)).toBe(
      "c2",
    );
  });

  test("exact email beats a fuzzy org signal for another company", () => {
    expect(
      matchEmailToCompany(
        row({ fromEmail: "pat@riverside.example", orgMatch: "Acme Holdings" }),
        companies,
      ),
    ).toBe("c1");
  });

  test("returns null when nothing matches", () => {
    expect(matchEmailToCompany(row({ fromEmail: "nobody@nowhere.example" }), companies)).toBeNull();
  });
});

describe("isPublishedSheetUrl", () => {
  test("accepts https docs.google.com", () => {
    expect(
      isPublishedSheetUrl("https://docs.google.com/spreadsheets/d/e/abc/pub?output=csv"),
    ).toBe(true);
  });

  test("rejects other hosts, http, and garbage", () => {
    expect(isPublishedSheetUrl("http://docs.google.com/x")).toBe(false);
    expect(isPublishedSheetUrl("https://evil.example/pub?output=csv")).toBe(false);
    expect(isPublishedSheetUrl("not a url")).toBe(false);
    expect(isPublishedSheetUrl("")).toBe(false);
  });
});
