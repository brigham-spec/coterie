import { describe, expect, it } from "vitest";

import { parseEventIdeas, type IdeaMember } from "@/lib/event-ideas";

// Unit tests for the PURE event-ideas parser (gap-audit cluster D). Guards the
// trust boundary the ephemeral suggestions rest on: tier-1/2 guests are validated
// against the supplied member roster (invented ids dropped, names re-attached),
// the event type is coerced to the canonical vocabulary, idealSize is clamped, and
// titleless ideas are dropped. No DB, no Anthropic.

const CO_A = "aaaaaaaa-0000-0000-0000-000000000000";
const CO_B = "bbbbbbbb-0000-0000-0000-000000000000";

function member(companyId: string, name: string): IdeaMember {
  return {
    companyId,
    name,
    industry: "Legal",
    status: "member",
    tags: [],
    canOffer: null,
    lookingFor: null,
    neverInvited: false,
  };
}

const roster = [member(CO_A, "Acme Mills"), member(CO_B, "Bolt Foundry")];

function wrap(ideas: unknown[]): string {
  return `Here are some ideas:\n${JSON.stringify(ideas)}\nHope that helps.`;
}

describe("parseEventIdeas", () => {
  it("parses a well-formed idea, re-attaching guest names from the roster", () => {
    const out = parseEventIdeas(
      wrap([
        {
          title: "Capital & Construction Roundtable",
          type: "roundtable",
          idealSize: 14,
          theme: "How members finance HV projects.",
          whyNow: "Three members hit capital-raise stage this month.",
          suggestedTiming: "within 3 weeks",
          suggestedVenue: "Acme Mills HQ",
          anchor: "Acme Mills",
          expectedOutcome: "A shared lender shortlist.",
          tier1: [{ companyId: CO_A, why: "hosting" }],
          tier2: [{ companyId: CO_B, why: "raising capital" }],
          tier3External: [
            { org: "Hudson Bank", why: "regional lender", isProspect: true },
          ],
          agenda: ["Intros", "Capital panel", "Open floor"],
        },
      ]),
      roster,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "Capital & Construction Roundtable",
      typeValue: "roundtable",
      idealSize: 14,
      tier1: [{ companyId: CO_A, name: "Acme Mills", why: "hosting" }],
      tier2: [{ companyId: CO_B, name: "Bolt Foundry", why: "raising capital" }],
      tier3External: [
        { org: "Hudson Bank", why: "regional lender", isProspect: true },
      ],
      agenda: ["Intros", "Capital panel", "Open floor"],
    });
  });

  it("drops tier guests whose companyId isn't a supplied member", () => {
    const out = parseEventIdeas(
      wrap([
        {
          title: "Dinner",
          type: "member_dinner",
          tier1: [
            { companyId: CO_A, why: "core" },
            { companyId: "cccccccc-0000-0000-0000-000000000000", why: "ghost" },
          ],
        },
      ]),
      roster,
    );
    expect(out[0].tier1.map((g) => g.companyId)).toEqual([CO_A]);
  });

  it("does not repeat a member across tier1 and tier2", () => {
    const out = parseEventIdeas(
      wrap([
        {
          title: "Dinner",
          type: "member_dinner",
          tier1: [{ companyId: CO_A, why: "essential" }],
          tier2: [{ companyId: CO_A, why: "also here" }],
        },
      ]),
      roster,
    );
    expect(out[0].tier1).toHaveLength(1);
    expect(out[0].tier2).toHaveLength(0);
  });

  it("coerces an unknown event type to 'other' and clamps idealSize", () => {
    const out = parseEventIdeas(
      wrap([
        { title: "Mystery", type: "flash_mob", idealSize: 999 },
        { title: "Tiny", type: "social", idealSize: 0 },
      ]),
      roster,
    );
    expect(out[0].typeValue).toBe("other");
    expect(out[0].idealSize).toBe(60);
    expect(out[1].idealSize).toBe(2);
  });

  it("uses a default size when idealSize is missing or non-numeric", () => {
    const out = parseEventIdeas(
      wrap([{ title: "No size", type: "panel", idealSize: "lots" }]),
      roster,
    );
    expect(out[0].idealSize).toBe(12);
  });

  it("drops ideas with no title", () => {
    const out = parseEventIdeas(
      wrap([
        { title: "", type: "social" },
        { type: "social" },
        { title: "Keeper", type: "social" },
      ]),
      roster,
    );
    expect(out.map((i) => i.title)).toEqual(["Keeper"]);
  });

  it("caps the number of ideas returned to six", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `Idea ${i}`,
      type: "social",
    }));
    const out = parseEventIdeas(wrap(many), roster);
    expect(out).toHaveLength(6);
  });

  it("returns [] for non-JSON or non-array responses", () => {
    expect(parseEventIdeas("no json here", roster)).toEqual([]);
    expect(parseEventIdeas(JSON.stringify({ not: "an array" }), roster)).toEqual(
      [],
    );
  });
});
