import { describe, expect, it } from "vitest";

import { buildOutreachDraft } from "@/lib/prospect-outreach";
import type { ProspectTarget } from "@/lib/prospect-finder";

// Unit tests for the PURE Draft-Outreach template (Finder 14): a copy-paste
// cold-outreach email assembled from a target's fit rationale plus the sender's
// identity, with missing fields skipped so a sparse result still reads cleanly.

const SENDER = { userName: "Dana Lee", orgName: "HVEDC" };

function target(overrides: Partial<ProspectTarget> = {}): ProspectTarget {
  return {
    org: "Ridgeline Development",
    contact: "Sam Rivera",
    title: "Managing Partner",
    industry: "Developer",
    county: "Dutchess",
    why: "They lead multifamily infill the network lacks.",
    theyGet: "warm intros to lenders and municipal contacts",
    theyBring: "a pipeline of transit-oriented sites",
    connectWith: "Acme Capital, Foo Architects",
    whyNow: "They just announced a downtown master plan.",
    website: "https://example.com",
    score: 4,
    ...overrides,
  };
}

describe("buildOutreachDraft", () => {
  it("includes a subject, greeting by first name, and a signature", () => {
    const draft = buildOutreachDraft(target(), SENDER);
    expect(draft.startsWith("Subject: HVEDC \u2014 connecting with Ridgeline Development")).toBe(true);
    expect(draft).toContain("Hi Sam,");
    expect(draft).toContain("I'm Dana Lee with HVEDC. They lead multifamily infill the network lacks.");
    expect(draft.trimEnd().endsWith("Best,\nDana Lee\nHVEDC")).toBe(true);
  });

  it("folds the value exchange and timeliness into the body", () => {
    const draft = buildOutreachDraft(target(), SENDER);
    expect(draft).toContain(
      "On our side, warm intros to lenders and municipal contacts. In turn, a pipeline of transit-oriented sites.",
    );
    expect(draft).toContain("They just announced a downtown master plan.");
  });

  it("greets 'there' when the target has no named contact", () => {
    const draft = buildOutreachDraft(target({ contact: "" }), SENDER);
    expect(draft).toContain("Hi there,");
  });

  it("falls back to a generic opener when there is no fit rationale", () => {
    const draft = buildOutreachDraft(target({ why: "" }), SENDER);
    expect(draft).toContain(
      "I'm Dana Lee with HVEDC, and I've been following the work at Ridgeline Development.",
    );
  });

  it("skips the exchange and timeliness paragraphs when those fields are empty", () => {
    const draft = buildOutreachDraft(
      target({ theyGet: "", theyBring: "", whyNow: "" }),
      SENDER,
    );
    expect(draft).not.toContain("On our side,");
    expect(draft).not.toContain("In turn,");
    // Still coherent: greeting, opener, call-to-action, signature.
    expect(draft).toContain("Would you be open to a short call in the next week or two?");
  });
});
