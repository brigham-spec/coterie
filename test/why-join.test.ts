import { describe, expect, test } from "vitest";

import {
  buildWhyJoinPrompt,
  parseWhyJoinPitch,
  type WhyJoinInput,
} from "@/lib/why-join";

// Unit coverage for the pure why-join pitch helpers. Asserts the parser tolerates
// prose/fenced JSON, coerces + caps topIntros, drops intros without a member name,
// and signals failure (null) when nothing usable comes back; and that the prompt
// embeds the prospect, network context, and members for grounding.

const input: WhyJoinInput = {
  orgName: "HVEDC",
  host: "Brigham Farrand",
  prospect: {
    name: "Riverside Capital",
    org: "Riverside Capital",
    industry: "Finance",
    seeking: "development deals",
    brings: "construction lending",
    notes: null,
  },
  memberCount: 12,
  industryPresence: "1 of 12 members work in Finance",
  openRoles: ["Mill Redevelopment (Capital Raise, mixed-use)"],
  members: [
    {
      name: "Alice",
      org: "Hudson Builders",
      industry: "Construction",
      seeking: "capital partners",
      brings: "GC services",
    },
  ],
};

const full = JSON.stringify({
  headline: "Deploy capital into a pipeline of vetted Hudson Valley deals.",
  networkValue: "You'd meet Alice at Hudson Builders on day one.",
  trackRecord: "HVEDC has closed multiple mixed-use raises.",
  openRoles: "The Mill Redevelopment needs a construction lender now.",
  industryPosition: "You'd be the network's anchor capital source.",
  topIntros: [
    { name: "Alice", org: "Hudson Builders", reason: "Needs a lending partner." },
  ],
  emailSubject: "An introduction to HVEDC",
  emailBody: "Dear Riverside,\n\nWe'd love to have you.\n\nBrigham",
});

describe("parseWhyJoinPitch", () => {
  test("parses a complete pitch object", () => {
    const pitch = parseWhyJoinPitch(full);
    expect(pitch).not.toBeNull();
    expect(pitch!.headline).toContain("Deploy capital");
    expect(pitch!.emailBody).toContain("Dear Riverside");
    expect(pitch!.topIntros).toHaveLength(1);
    expect(pitch!.topIntros[0]).toEqual({
      name: "Alice",
      org: "Hudson Builders",
      reason: "Needs a lending partner.",
    });
  });

  test("tolerates prose and markdown fences around the object", () => {
    const wrapped = "Here you go:\n```json\n" + full + "\n```\nHope that helps!";
    expect(parseWhyJoinPitch(wrapped)).not.toBeNull();
  });

  test("returns null when nothing usable comes back", () => {
    expect(parseWhyJoinPitch("no json here")).toBeNull();
    expect(parseWhyJoinPitch("{}")).toBeNull();
    expect(
      parseWhyJoinPitch(JSON.stringify({ networkValue: "some value" })),
    ).toBeNull();
  });

  test("keeps a pitch with only an email body (no headline)", () => {
    const pitch = parseWhyJoinPitch(
      JSON.stringify({ emailBody: "Come join us." }),
    );
    expect(pitch).not.toBeNull();
    expect(pitch!.headline).toBe("");
    expect(pitch!.emailBody).toBe("Come join us.");
  });

  test("drops intros without a member name and caps the list", () => {
    const many = JSON.stringify({
      headline: "Join.",
      topIntros: [
        { name: "A", reason: "r1" },
        { org: "no name here", reason: "r2" },
        { name: "B", org: "Org B", reason: "r3" },
        { name: "C", reason: "r4" },
        { name: "D", reason: "r5" },
        { name: "E", reason: "r6" },
      ],
    });
    const pitch = parseWhyJoinPitch(many);
    expect(pitch!.topIntros.map((i) => i.name)).toEqual(["A", "B", "C", "D"]);
    expect(pitch!.topIntros[0].org).toBeNull();
    expect(pitch!.topIntros[1].org).toBe("Org B");
  });

  test("ignores non-object JSON (e.g. an array)", () => {
    expect(parseWhyJoinPitch("[1, 2, 3]")).toBeNull();
  });
});

describe("buildWhyJoinPrompt", () => {
  test("embeds the prospect, network context, host, and members", () => {
    const prompt = buildWhyJoinPrompt(input);
    expect(prompt).toContain("HVEDC");
    expect(prompt).toContain("Riverside Capital");
    expect(prompt).toContain("12 active members");
    expect(prompt).toContain("1 of 12 members work in Finance");
    expect(prompt).toContain("Mill Redevelopment (Capital Raise, mixed-use)");
    expect(prompt).toContain("Hudson Builders");
    expect(prompt).toContain("Sign as Brigham Farrand");
  });

  test("marks the absence of open roles", () => {
    const prompt = buildWhyJoinPrompt({ ...input, openRoles: [] });
    expect(prompt).toContain("(none identified)");
  });
});
