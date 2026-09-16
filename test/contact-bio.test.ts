import { describe, expect, test } from "vitest";

import {
  buildContactBioPrompt,
  parseContactBio,
  type ContactBioContext,
} from "@/lib/contact-bio";

// Unit coverage for the pure contact-bio helpers. Asserts the parser pulls a JSON
// object out of fenced / prose-wrapped output (web-search replies are chatty),
// coerces the bio to a bounded string, treats the literal "null" / a non-string /
// an empty bio as "nothing found" (null); and that the prompt embeds the known
// facts, the LinkedIn anchor, and the exact JSON shape we consume.

describe("parseContactBio", () => {
  const bio =
    "Jane Doe is the founder and CEO of Acme Mills, a Hudson Valley contract manufacturer. She previously led operations at a regional supplier and focuses on advanced manufacturing partnerships.";

  test("extracts the bio from a clean JSON object", () => {
    expect(parseContactBio(JSON.stringify({ bio }))).toBe(bio);
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Here is the bio:\n```json\n" + JSON.stringify({ bio }) + "\n```\nDone.";
    expect(parseContactBio(raw)).toBe(bio);
  });

  test("returns null for an empty bio", () => {
    expect(parseContactBio(JSON.stringify({ bio: "" }))).toBeNull();
  });

  test('treats the literal string "null" as null', () => {
    expect(parseContactBio(JSON.stringify({ bio: "null" }))).toBeNull();
  });

  test("returns null for a non-string bio", () => {
    expect(parseContactBio(JSON.stringify({ bio: 42 }))).toBeNull();
  });

  test("returns null when no JSON object is present", () => {
    expect(parseContactBio("no json here")).toBeNull();
    expect(parseContactBio("")).toBeNull();
  });

  test("bounds an overly long bio to 800 characters", () => {
    const long = "a".repeat(1000);
    expect(parseContactBio(JSON.stringify({ bio: long }))!.length).toBe(800);
  });
});

describe("buildContactBioPrompt", () => {
  const context: ContactBioContext = {
    orgName: "Hudson Valley EDC",
    name: "Jane Doe",
    title: "Founder & CEO",
    company: "Acme Mills",
    linkedin: "https://linkedin.com/in/janedoe",
  };

  test("embeds the known facts, the LinkedIn anchor, and the JSON shape", () => {
    const prompt = buildContactBioPrompt(context);
    expect(prompt).toContain("Hudson Valley EDC");
    expect(prompt).toContain("Name: Jane Doe");
    expect(prompt).toContain("Title: Founder & CEO");
    expect(prompt).toContain("Company: Acme Mills");
    expect(prompt).toContain("LinkedIn: https://linkedin.com/in/janedoe");
    expect(prompt).toContain(
      "Start from their LinkedIn profile: https://linkedin.com/in/janedoe",
    );
    expect(prompt).toContain('"bio"');
  });

  test("falls back to a name search when no LinkedIn URL is set", () => {
    const prompt = buildContactBioPrompt({ ...context, linkedin: null });
    expect(prompt).not.toContain("LinkedIn:");
    expect(prompt).toContain('Search for "Jane Doe" at Acme Mills');
  });
});
