import { describe, expect, test } from "vitest";

import {
  buildIntroEmailPrompt,
  parseIntroEmail,
  type IntroEmailInput,
} from "@/lib/intro-email";

// Unit coverage for the pure draft-introduction-email helpers. Asserts the parser
// splits a "SUBJECT:" line from the body, tolerates a missing subject and markdown
// fences, and signals failure (null) when nothing usable comes back; and that the
// prompt embeds both party profiles, the host/org, and any supplied reason.

const input: IntroEmailInput = {
  orgName: "HVEDC",
  host: "Brigham Farrand",
  partyA: {
    name: "Alice Mason",
    org: "Hudson Builders",
    title: "Principal",
    industry: "Construction",
    seeking: "capital partners",
    brings: "GC services",
  },
  partyB: {
    name: "Ray Cole",
    org: "Riverside Capital",
    title: "Managing Director",
    industry: "Finance",
    seeking: "development deals",
    brings: "construction lending",
  },
  context: "as a construction partner for the Mill Redevelopment",
};

describe("parseIntroEmail", () => {
  test("splits a subject line from the body", () => {
    const draft = parseIntroEmail(
      "SUBJECT: Alice, meet Ray\n\nHi Alice,\n\nI'd like to connect you.\n\nBrigham",
    );
    expect(draft).not.toBeNull();
    expect(draft!.subject).toBe("Alice, meet Ray");
    expect(draft!.body).toContain("Hi Alice");
    expect(draft!.body).toContain("Brigham");
    expect(draft!.body.startsWith("SUBJECT")).toBe(false);
  });

  test("tolerates markdown fences around the whole draft", () => {
    const draft = parseIntroEmail(
      "```\nSUBJECT: Intro\n\nBody here.\n```",
    );
    expect(draft).not.toBeNull();
    expect(draft!.subject).toBe("Intro");
    expect(draft!.body).toBe("Body here.");
  });

  test("keeps a body with no subject line (subject empty)", () => {
    const draft = parseIntroEmail("Hi both,\n\nConnecting you now.");
    expect(draft).not.toBeNull();
    expect(draft!.subject).toBe("");
    expect(draft!.body).toBe("Hi both,\n\nConnecting you now.");
  });

  test("returns null for empty / whitespace-only input", () => {
    expect(parseIntroEmail("")).toBeNull();
    expect(parseIntroEmail("   \n  ")).toBeNull();
  });

  test("returns null when only a subject line comes back (no body)", () => {
    expect(parseIntroEmail("SUBJECT: Nothing follows")).toBeNull();
  });
});

describe("buildIntroEmailPrompt", () => {
  test("embeds both party profiles, the host/org, and the reason", () => {
    const prompt = buildIntroEmailPrompt(input);
    expect(prompt).toContain("Brigham Farrand");
    expect(prompt).toContain("HVEDC");
    expect(prompt).toContain("Alice Mason");
    expect(prompt).toContain("Hudson Builders");
    expect(prompt).toContain("Ray Cole");
    expect(prompt).toContain("Riverside Capital");
    expect(prompt).toContain("SPECIFIC CONTEXT");
    expect(prompt).toContain("Mill Redevelopment");
  });

  test("omits the context section when no reason is supplied", () => {
    const prompt = buildIntroEmailPrompt({ ...input, context: "   " });
    expect(prompt).not.toContain("SPECIFIC CONTEXT");
  });

  test("marks a party with no profile on record", () => {
    const prompt = buildIntroEmailPrompt({
      ...input,
      partyB: {
        name: "",
        org: null,
        title: null,
        industry: null,
        seeking: null,
        brings: null,
      },
    });
    expect(prompt).toContain("(no profile on record)");
  });
});
