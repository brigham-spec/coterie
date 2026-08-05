import { describe, expect, test } from "vitest";

import {
  buildThreadPrompt,
  parseEmailThreadExtraction,
} from "@/lib/extract-email-thread";

// Pure-logic tests for the org-level email-thread extractor: the parser must pull
// a JSON object out of any fence/prose, coerce every field to a bounded string,
// drop padded/blank prospect rows, and refuse a completion that carries nothing
// usable. The prompt must ground the model in the org's own members.

describe("parseEmailThreadExtraction", () => {
  test("parses a fenced JSON object and coerces every field", () => {
    const raw = [
      "Here you go:",
      "```json",
      JSON.stringify({
        primaryContact: {
          name: "Jane Doe",
          org: "Acme Mills",
          email: "jane@acmemills.example",
          title: "COO",
        },
        meetingTitle: "RE: Kingston site tour",
        meetingDate: "2026-06-30",
        summary: "They confirmed the tour.",
        actionItems: "Send term sheet; schedule tour",
        keyInsights: "Weighing two counties.",
        newProspects: [
          { name: "Sam Lee", org: "Riverside Logistics", email: "", notes: "Warehouse." },
        ],
      }),
      "```",
    ].join("\n");

    const out = parseEmailThreadExtraction(raw);
    expect(out).not.toBeNull();
    expect(out!.primaryContact).toEqual({
      name: "Jane Doe",
      org: "Acme Mills",
      email: "jane@acmemills.example",
      title: "COO",
    });
    expect(out!.meetingTitle).toBe("RE: Kingston site tour");
    expect(out!.summary).toBe("They confirmed the tour.");
    expect(out!.actionItems).toBe("Send term sheet; schedule tour");
    expect(out!.newProspects).toEqual([
      { name: "Sam Lee", org: "Riverside Logistics", email: "", notes: "Warehouse." },
    ]);
  });

  test("drops prospect rows with neither name nor org, and the literal \"null\"", () => {
    const out = parseEmailThreadExtraction(
      JSON.stringify({
        primaryContact: { name: "Pat", org: "null", email: "", title: "" },
        summary: "Hi",
        newProspects: [
          { name: "", org: "", email: "x@y.z", notes: "blank" },
          { name: "Real Person", org: "Real Org", email: "", notes: "" },
        ],
      }),
    );
    expect(out).not.toBeNull();
    // "null" collapses to "".
    expect(out!.primaryContact.org).toBe("");
    // Only the identifiable prospect survives.
    expect(out!.newProspects).toHaveLength(1);
    expect(out!.newProspects[0].name).toBe("Real Person");
  });

  test("returns null when nothing usable came back", () => {
    expect(parseEmailThreadExtraction("not json at all")).toBeNull();
    expect(
      parseEmailThreadExtraction(
        JSON.stringify({
          primaryContact: { name: "", org: "", email: "", title: "" },
          summary: "",
          meetingTitle: "",
        }),
      ),
    ).toBeNull();
  });
});

describe("buildThreadPrompt", () => {
  test("grounds the model in the org name and its members", () => {
    const prompt = buildThreadPrompt(
      { orgName: "HVEDC", memberOrgs: ["Acme Mills", "Beta Corp"] },
      "From: jane@acmemills.example\nHello",
    );
    expect(prompt).toContain("HVEDC");
    expect(prompt).toContain("Acme Mills, Beta Corp");
    expect(prompt).toContain("jane@acmemills.example");
  });
});
