import { describe, expect, it } from "vitest";

import { buildPrepContext, type MeetingPrepInput } from "@/lib/meeting-prep";

// Unit test for the PURE prep-context builder (gap-audit cluster A). Guards the
// grounding block the model reads: present fields appear, absent/empty fields are
// omitted entirely, and each open commitment is labelled with the side that owes.
// No DB, no Anthropic.

const full: MeetingPrepInput = {
  userName: "Alex",
  company: {
    name: "Acme Mills",
    status: "member",
    industry: "Manufacturing",
    tier: "Director",
    lookingFor: "a capital partner",
    canOffer: "warehouse space",
    notes: "Expanding the Kingston site.",
    contacts: [
      { name: "Jane Doe", title: "CFO" },
      { name: "Sam Poe", title: null },
    ],
    projects: [{ name: "Riverfront", stage: "planning_board", role: "developer" }],
  },
  recentMeetings: [
    { title: "Q3 check-in", heldAt: "2026-06-01", summary: "Discussed the IDA application." },
    { title: "Intro call", heldAt: "2026-05-10", summary: null },
  ],
  openCommitments: [
    { text: "Send the IDA draft", owedBy: "us" },
    { text: "Share their board deck", owedBy: "them" },
  ],
};

describe("buildPrepContext", () => {
  it("includes every populated field", () => {
    const ctx = buildPrepContext(full);
    expect(ctx).toContain("COMPANY: Acme Mills");
    expect(ctx).toContain("STATUS: member");
    expect(ctx).toContain("TIER: Director");
    expect(ctx).toContain("INDUSTRY: Manufacturing");
    expect(ctx).toContain("LOOKING FOR: a capital partner");
    expect(ctx).toContain("CAN OFFER: warehouse space");
    expect(ctx).toContain("NOTES: Expanding the Kingston site.");
    expect(ctx).toContain("Jane Doe (CFO)");
    expect(ctx).toContain("Sam Poe"); // no parens when title is null
    expect(ctx).not.toContain("Sam Poe (");
    expect(ctx).toContain("Riverfront — planning_board (developer)");
    expect(ctx).toContain("2026-06-01: Q3 check-in — Discussed the IDA application.");
    expect(ctx).toContain("2026-05-10: Intro call");
  });

  it("labels each commitment with the side that owes it", () => {
    const ctx = buildPrepContext(full);
    expect(ctx).toContain("(we owe them) Send the IDA draft");
    expect(ctx).toContain("(they owe us) Share their board deck");
  });

  it("omits absent fields and empty sections entirely", () => {
    const ctx = buildPrepContext({
      userName: "Alex",
      company: {
        name: "Bare Co",
        status: "prospect",
        industry: null,
        tier: null,
        lookingFor: null,
        canOffer: null,
        notes: null,
        contacts: [],
        projects: [],
      },
      recentMeetings: [],
      openCommitments: [],
    });
    expect(ctx).toContain("COMPANY: Bare Co");
    expect(ctx).toContain("STATUS: prospect");
    expect(ctx).not.toContain("TIER:");
    expect(ctx).not.toContain("INDUSTRY:");
    expect(ctx).not.toContain("CONTACTS:");
    expect(ctx).not.toContain("PROJECTS:");
    expect(ctx).not.toContain("RECENT MEETINGS");
    expect(ctx).not.toContain("OPEN COMMITMENTS");
  });
});
