import { describe, expect, it } from "vitest";

import {
  buildPrepContext,
  parseMeetingPrep,
  type MeetingPrepInput,
} from "@/lib/meeting-prep";

// Unit test for the PURE prep-context builder + parser (gap-audit cluster A).
// buildPrepContext guards the grounding block the model reads: present fields
// appear, absent/empty fields are omitted entirely, each open commitment is
// labelled with the side that owes, and the news/value/candidate sections fold in.
// parseMeetingPrep guards the model's structured output: the narrative is read and
// every intro recommendation's companyId is validated against the candidate pool
// (hallucinated ids dropped). No DB, no Anthropic.

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
  recentNews: [
    { headline: "Acme breaks ground in Kingston", capturedAt: "2026-06-20" },
  ],
  valueSnapshot: { totalAmount: 125000, entryCount: 3, monetaryCount: 2 },
  candidates: [
    {
      id: "cand-1",
      name: "Riverside Capital",
      industry: "Finance",
      lookingFor: "manufacturing deals",
      canOffer: "growth capital",
    },
    {
      id: "cand-2",
      name: "Empty Fit",
      industry: null,
      lookingFor: null,
      canOffer: null,
    },
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

  it("folds in news, the value snapshot, and the candidate pool", () => {
    const ctx = buildPrepContext(full);
    expect(ctx).toContain("2026-06-20: Acme breaks ground in Kingston");
    expect(ctx).toContain("VALUE DELIVERED SO FAR: 3 wins");
    expect(ctx).toContain("$125,000 across 2 of them");
    expect(ctx).toContain("[cand-1] Riverside Capital");
    expect(ctx).toContain("looking for manufacturing deals");
    expect(ctx).toContain("offers growth capital");
    // A candidate with no signals still lists (id + name), no trailing dash.
    expect(ctx).toContain("[cand-2] Empty Fit");
  });

  it("notes when value has no dollar figure attached", () => {
    const ctx = buildPrepContext({
      ...full,
      valueSnapshot: { totalAmount: 0, entryCount: 1, monetaryCount: 0 },
    });
    expect(ctx).toContain("VALUE DELIVERED SO FAR: 1 win");
    expect(ctx).toContain("no dollar figure attached yet");
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
      recentNews: [],
      valueSnapshot: { totalAmount: 0, entryCount: 0, monetaryCount: 0 },
      candidates: [],
    });
    expect(ctx).toContain("COMPANY: Bare Co");
    expect(ctx).toContain("STATUS: prospect");
    expect(ctx).not.toContain("TIER:");
    expect(ctx).not.toContain("INDUSTRY:");
    expect(ctx).not.toContain("CONTACTS:");
    expect(ctx).not.toContain("PROJECTS:");
    expect(ctx).not.toContain("RECENT MEETINGS");
    expect(ctx).not.toContain("OPEN COMMITMENTS");
    expect(ctx).not.toContain("RECENT NEWS");
    expect(ctx).not.toContain("VALUE DELIVERED");
    expect(ctx).not.toContain("CANDIDATE COMPANIES");
  });
});

describe("parseMeetingPrep", () => {
  const validIds = new Set(["cand-1", "cand-2"]);

  it("reads the narrative and keeps grounded intro recommendations", () => {
    const raw = JSON.stringify({
      narrative: "Pick up where the IDA application left off.",
      introRecommendations: [
        { companyId: "cand-1", companyName: "Riverside Capital", reason: "capital fit" },
      ],
    });
    const brief = parseMeetingPrep(raw, validIds);
    expect(brief.narrative).toBe("Pick up where the IDA application left off.");
    expect(brief.introRecommendations).toEqual([
      { companyId: "cand-1", companyName: "Riverside Capital", reason: "capital fit" },
    ]);
  });

  it("drops a recommendation whose companyId is not in the pool", () => {
    const raw = JSON.stringify({
      narrative: "n",
      introRecommendations: [
        { companyId: "ghost", companyName: "Invented Co", reason: "hallucinated" },
        { companyId: "cand-2", companyName: "Empty Fit", reason: "real" },
      ],
    });
    const brief = parseMeetingPrep(raw, validIds);
    expect(brief.introRecommendations.map((r) => r.companyId)).toEqual(["cand-2"]);
  });

  it("caps recommendations at 3", () => {
    const raw = JSON.stringify({
      narrative: "n",
      introRecommendations: Array.from({ length: 5 }, () => ({
        companyId: "cand-1",
        companyName: "Riverside Capital",
        reason: "r",
      })),
    });
    expect(parseMeetingPrep(raw, validIds).introRecommendations).toHaveLength(3);
  });

  it("returns an empty brief for malformed output", () => {
    expect(parseMeetingPrep("not json", validIds)).toEqual({
      narrative: "",
      introRecommendations: [],
    });
  });
});
