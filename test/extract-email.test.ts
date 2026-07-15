import { describe, expect, test } from "vitest";

import {
  buildEmailPrompt,
  parseEmailExtraction,
  type EmailExtractionContext,
} from "@/lib/extract-email";

// Unit coverage for the pure extract-email helpers. Asserts the parser pulls a
// JSON object out of fenced / prose-wrapped output, coerces every field to a
// bounded string, treats the literal "null" as empty, normalises sentiment to the
// teal/red/slate vocabulary, and signals failure (null) when the thread was
// unreadable (no subject AND no summary); and that the prompt embeds the member,
// its contacts, and the exact JSON shape we consume.

const full = JSON.stringify({
  subject: "Kingston site tour follow-up",
  summary: "They confirmed the Sept 12 tour and asked for the IDA PILOT term sheet.",
  projects: "Kingston Mill Redevelopment",
  actionItems: "Send PILOT term sheet; schedule the site tour",
  sentiment: "positive",
  emailDate: "2026-06-30",
  fromName: "Jane Doe",
  fromEmail: "jane@acmemills.example",
});

describe("parseEmailExtraction", () => {
  test("extracts every field from a clean JSON object", () => {
    const e = parseEmailExtraction(full);
    expect(e).not.toBeNull();
    expect(e).toEqual({
      subject: "Kingston site tour follow-up",
      summary:
        "They confirmed the Sept 12 tour and asked for the IDA PILOT term sheet.",
      projects: "Kingston Mill Redevelopment",
      actionItems: "Send PILOT term sheet; schedule the site tour",
      sentiment: "positive",
      emailDate: "2026-06-30",
      fromName: "Jane Doe",
      fromEmail: "jane@acmemills.example",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Here's what I found:\n```json\n" + full + "\n```\nDone.";
    const e = parseEmailExtraction(raw);
    expect(e).not.toBeNull();
    expect(e!.subject).toBe("Kingston site tour follow-up");
  });

  test("normalises an out-of-vocabulary sentiment to empty", () => {
    const e = parseEmailExtraction(
      JSON.stringify({ subject: "Hi", sentiment: "enthusiastic" }),
    );
    expect(e).not.toBeNull();
    expect(e!.sentiment).toBe("");
  });

  test("keeps positive/neutral/negative sentiment (case-insensitive)", () => {
    expect(parseEmailExtraction(JSON.stringify({ subject: "a", sentiment: "NEGATIVE" }))!.sentiment).toBe("negative");
    expect(parseEmailExtraction(JSON.stringify({ subject: "a", sentiment: "Neutral" }))!.sentiment).toBe("neutral");
  });

  test('treats the literal string "null" as empty', () => {
    const e = parseEmailExtraction(
      JSON.stringify({ subject: "Re: proposal", projects: "null", fromEmail: "null" }),
    );
    expect(e).not.toBeNull();
    expect(e!.projects).toBe("");
    expect(e!.fromEmail).toBe("");
  });

  test("coerces non-string fields to empty strings", () => {
    const e = parseEmailExtraction(
      JSON.stringify({ subject: "Update", projects: 42, actionItems: null }),
    );
    expect(e).not.toBeNull();
    expect(e!.projects).toBe("");
    expect(e!.actionItems).toBe("");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseEmailExtraction("no json here")).toBeNull();
    expect(parseEmailExtraction("")).toBeNull();
  });

  test("returns null when neither subject nor summary is present", () => {
    // Action items alone can't anchor a message — nothing readable came back.
    const e = parseEmailExtraction(
      JSON.stringify({ actionItems: "call them back", sentiment: "positive" }),
    );
    expect(e).toBeNull();
  });

  test("keeps a message with only a summary", () => {
    const e = parseEmailExtraction(
      JSON.stringify({ summary: "Quick note confirming receipt." }),
    );
    expect(e).not.toBeNull();
    expect(e!.summary).toBe("Quick note confirming receipt.");
    expect(e!.subject).toBe("");
  });
});

describe("buildEmailPrompt", () => {
  const context: EmailExtractionContext = {
    orgName: "Acme Mills",
    contactNames: ["Jane Doe", "John Roe"],
  };

  test("embeds the member, its contacts, the thread, and the JSON shape", () => {
    const prompt = buildEmailPrompt(context, "From: jane@acmemills.example\nHi there");
    expect(prompt).toContain("Acme Mills");
    expect(prompt).toContain("Jane Doe, John Roe");
    expect(prompt).toContain("From: jane@acmemills.example");
    expect(prompt).toContain('"actionItems"');
    expect(prompt).toContain('"sentiment"');
  });

  test("falls back to a placeholder when no contacts are on file", () => {
    const prompt = buildEmailPrompt({ ...context, contactNames: [] }, "body");
    expect(prompt).toContain("(none on file)");
  });

  test("truncates a very long thread to keep the request small", () => {
    const long = "x".repeat(7000);
    const prompt = buildEmailPrompt(context, long);
    expect(prompt).toContain("x".repeat(6000));
    expect(prompt).not.toContain("x".repeat(6001));
  });
});
