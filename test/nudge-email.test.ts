import { describe, expect, test } from "vitest";

import {
  buildNudgeEmailPrompt,
  parseNudgeEmail,
  type NudgeEmailInput,
} from "@/lib/nudge-email";

// Unit coverage for the pure nudge-email helpers. Asserts the parser strips a
// wrapping markdown fence, keeps the body verbatim, and signals failure (null)
// on empty input; and that the prompt grounds the nudge in the one outstanding
// commitment, names the host + org as the party waiting, and only mentions
// overdue when a positive count is supplied.

const input: NudgeEmailInput = {
  orgName: "HVEDC",
  host: "Brigham Farrand",
  contactName: "Ray Cole",
  companyName: "Riverside Capital",
  commitment: "Send over the signed term sheet for the Mill Redevelopment",
  meetingTitle: "Q3 partnership sync",
  overdueDays: 5,
};

describe("parseNudgeEmail", () => {
  test("keeps a plain body verbatim", () => {
    const draft = parseNudgeEmail(
      "Just following up on the term sheet — no rush.",
    );
    expect(draft).not.toBeNull();
    expect(draft!.body).toBe("Just following up on the term sheet — no rush.");
  });

  test("strips a wrapping markdown fence", () => {
    const draft = parseNudgeEmail("```\nBody of the nudge.\n```");
    expect(draft).not.toBeNull();
    expect(draft!.body).toBe("Body of the nudge.");
  });

  test("returns null for empty / whitespace-only input", () => {
    expect(parseNudgeEmail("")).toBeNull();
    expect(parseNudgeEmail("   \n  ")).toBeNull();
  });
});

describe("buildNudgeEmailPrompt", () => {
  test("grounds the nudge in the commitment, host, org, and contact", () => {
    const prompt = buildNudgeEmailPrompt(input);
    expect(prompt).toContain("Brigham Farrand");
    expect(prompt).toContain("HVEDC");
    expect(prompt).toContain("Ray Cole");
    expect(prompt).toContain("Riverside Capital");
    expect(prompt).toContain("Mill Redevelopment");
    expect(prompt).toContain("Q3 partnership sync");
  });

  test("notes the overdue count when positive (with correct pluralization)", () => {
    expect(buildNudgeEmailPrompt(input)).toContain("Overdue by: 5 days");
    expect(
      buildNudgeEmailPrompt({ ...input, overdueDays: 1 }),
    ).toContain("Overdue by: 1 day");
  });

  test("omits overdue when null or not positive", () => {
    expect(
      buildNudgeEmailPrompt({ ...input, overdueDays: null }),
    ).not.toContain("Overdue by");
    expect(
      buildNudgeEmailPrompt({ ...input, overdueDays: 0 }),
    ).not.toContain("Overdue by");
  });

  test("omits optional lines that have no value on record", () => {
    const prompt = buildNudgeEmailPrompt({
      ...input,
      companyName: null,
      meetingTitle: null,
    });
    expect(prompt).not.toContain("Company:");
    expect(prompt).not.toContain("Committed during:");
  });
});
