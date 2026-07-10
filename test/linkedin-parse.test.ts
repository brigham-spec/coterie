import { describe, expect, test } from "vitest";

import {
  buildLinkedInPrompt,
  parseLinkedInProfile,
} from "@/lib/linkedin-parse";

// Unit coverage for the pure LinkedIn-parse helpers. Asserts the parser pulls a
// JSON object out of fenced / prose-wrapped output, coerces every field to a
// string, defaults missing fields to "", and signals failure (null) when nothing
// usable comes back; and that the prompt embeds the structure hint and the pasted
// profile text.

const full = JSON.stringify({
  name: "Alice Mason",
  org: "Hudson Builders",
  title: "Principal",
  industry: "Contractor",
  email: "alice@hudsonbuilders.com",
  phone: "555-1234",
  linkedin: "https://linkedin.com/in/alicemason",
  website: "https://hudsonbuilders.com",
  location: "Kingston, NY",
  lookingFor: "capital partners",
  canOffer: "GC services",
  notes: "Third-generation builder leading Hudson Builders.",
});

describe("parseLinkedInProfile", () => {
  test("extracts every field from a clean JSON object", () => {
    const p = parseLinkedInProfile(full);
    expect(p).not.toBeNull();
    expect(p).toEqual({
      name: "Alice Mason",
      org: "Hudson Builders",
      title: "Principal",
      industry: "Contractor",
      email: "alice@hudsonbuilders.com",
      phone: "555-1234",
      linkedin: "https://linkedin.com/in/alicemason",
      website: "https://hudsonbuilders.com",
      location: "Kingston, NY",
      lookingFor: "capital partners",
      canOffer: "GC services",
      notes: "Third-generation builder leading Hudson Builders.",
    });
  });

  test("pulls the object out of a markdown fence with surrounding prose", () => {
    const raw = "Here is the profile:\n```json\n" + full + "\n```\nDone.";
    const p = parseLinkedInProfile(raw);
    expect(p).not.toBeNull();
    expect(p!.org).toBe("Hudson Builders");
  });

  test("defaults missing fields to empty strings and coerces non-strings", () => {
    const p = parseLinkedInProfile(
      JSON.stringify({ name: "Ray Cole", org: "Riverside", phone: 5551234 }),
    );
    expect(p).not.toBeNull();
    expect(p!.name).toBe("Ray Cole");
    expect(p!.org).toBe("Riverside");
    expect(p!.title).toBe("");
    expect(p!.email).toBe("");
    // A numeric phone is not a string → coerced to "".
    expect(p!.phone).toBe("");
  });

  test("returns null when no JSON object is present", () => {
    expect(parseLinkedInProfile("no json here")).toBeNull();
    expect(parseLinkedInProfile("")).toBeNull();
  });

  test("returns null when neither a name nor an org came back", () => {
    expect(
      parseLinkedInProfile(JSON.stringify({ title: "Principal", email: "a@b.com" })),
    ).toBeNull();
  });

  test("keeps a record with an org but no contact name", () => {
    const p = parseLinkedInProfile(JSON.stringify({ org: "Beta Corp" }));
    expect(p).not.toBeNull();
    expect(p!.org).toBe("Beta Corp");
    expect(p!.name).toBe("");
  });
});

describe("buildLinkedInPrompt", () => {
  test("embeds the structure hint and the pasted profile text", () => {
    const prompt = buildLinkedInPrompt("Alice Mason — Principal at Hudson Builders");
    expect(prompt).toContain('"lookingFor"');
    expect(prompt).toContain('"canOffer"');
    expect(prompt).toContain("PROFILE:");
    expect(prompt).toContain("Alice Mason — Principal at Hudson Builders");
  });

  test("caps an over-long profile to keep the prompt bounded", () => {
    const long = "x".repeat(9000);
    const prompt = buildLinkedInPrompt(long);
    expect(prompt).not.toContain("x".repeat(6001));
    expect(prompt).toContain("x".repeat(6000));
  });
});
