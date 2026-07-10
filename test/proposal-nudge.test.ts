import { describe, expect, test } from "vitest";

import { buildProposalNudge, type NudgeProposal } from "@/lib/proposal-nudge";

// Pure-logic tests for the proposal follow-up nudge: the >7-day staleness edge,
// the lastFollowUpAt → sentOn → createdAt contact fallback, terminal-status
// exclusion, most-overdue-first ordering, and the null (all-caught-up) result.

// Fixed "now" = 2026-07-20 (local midnight). Dates built in UTC so the day delta
// is deterministic across zones.
const now = new Date(2026, 6, 20);
const on = (day: number) => new Date(Date.UTC(2026, 6, day));

function proposal(over: Partial<NudgeProposal>): NudgeProposal {
  return {
    id: over.id ?? "p",
    companyName: over.companyName ?? "Acme",
    status: over.status ?? "sent",
    sentOn: over.sentOn ?? null,
    lastFollowUpAt: over.lastFollowUpAt ?? null,
    createdAt: over.createdAt ?? on(20),
  };
}

describe("buildProposalNudge", () => {
  test("flags open proposals past 7 days without contact; fresh ones excluded", () => {
    const nudge = buildProposalNudge(
      [
        // 12 days since it was sent — stale.
        proposal({ id: "stale", sentOn: on(8) }),
        // exactly 7 days — not yet stale (strictly greater than 7).
        proposal({ id: "edge", sentOn: on(13) }),
        // 3 days — fresh.
        proposal({ id: "fresh", sentOn: on(17) }),
      ],
      now,
    );
    expect(nudge).not.toBeNull();
    expect(nudge!.stale.map((s) => s.id)).toEqual(["stale"]);
    expect(nudge!.oldestDays).toBe(12);
  });

  test("uses lastFollowUpAt over sentOn, and createdAt as last resort", () => {
    const nudge = buildProposalNudge(
      [
        // A recent follow-up resets the clock even though it was sent long ago.
        proposal({ id: "chased", sentOn: on(1), lastFollowUpAt: on(18) }),
        // Never sent, created 10 days ago — the createdAt fallback flags it.
        proposal({ id: "draft", status: "draft", createdAt: on(10) }),
      ],
      now,
    );
    expect(nudge!.stale.map((s) => s.id)).toEqual(["draft"]);
    expect(nudge!.stale[0].daysSinceContact).toBe(10);
  });

  test("excludes won and lost, even when long untouched", () => {
    const nudge = buildProposalNudge(
      [
        proposal({ id: "won", status: "won", sentOn: on(1) }),
        proposal({ id: "lost", status: "lost", sentOn: on(1) }),
      ],
      now,
    );
    expect(nudge).toBeNull();
  });

  test("sorts most overdue first and reports the oldest gap", () => {
    const nudge = buildProposalNudge(
      [
        proposal({ id: "mid", sentOn: on(6) }), // 14d
        proposal({ id: "worst", sentOn: on(2) }), // 18d
        proposal({ id: "least", sentOn: on(11) }), // 9d
      ],
      now,
    );
    expect(nudge!.stale.map((s) => s.id)).toEqual(["worst", "mid", "least"]);
    expect(nudge!.oldestDays).toBe(18);
  });

  test("returns null when nothing is stale", () => {
    expect(buildProposalNudge([], now)).toBeNull();
    expect(
      buildProposalNudge([proposal({ sentOn: on(19) })], now),
    ).toBeNull();
  });
});
