import { describe, expect, test } from "vitest";

import {
  buildReferralLeaderboard,
  type ReferralCompany,
} from "@/lib/referral-leaderboard";

// Pure-logic tests for the referral leaderboard: referrers are tallied by how
// many companies point back at them, unresolved/absent referrers are skipped,
// and ties break alphabetically for a stable render.

function company(over: Partial<ReferralCompany>): ReferralCompany {
  return { id: "c1", name: "Acme", referredById: null, ...over };
}

describe("buildReferralLeaderboard", () => {
  test("no referrals produces an empty leaderboard", () => {
    expect(
      buildReferralLeaderboard([company({ id: "a" }), company({ id: "b" })]),
    ).toEqual([]);
  });

  test("tallies referrals per referrer, most first", () => {
    const board = buildReferralLeaderboard([
      company({ id: "ref1", name: "Referrer One" }),
      company({ id: "ref2", name: "Referrer Two" }),
      company({ id: "x", referredById: "ref1" }),
      company({ id: "y", referredById: "ref1" }),
      company({ id: "z", referredById: "ref2" }),
    ]);
    expect(board).toEqual([
      { id: "ref1", name: "Referrer One", count: 2 },
      { id: "ref2", name: "Referrer Two", count: 1 },
    ]);
  });

  test("ties break alphabetically by referrer name", () => {
    const board = buildReferralLeaderboard([
      company({ id: "z", name: "Zeta" }),
      company({ id: "a", name: "Alpha" }),
      company({ id: "x", referredById: "z" }),
      company({ id: "w", referredById: "a" }),
    ]);
    expect(board.map((e) => e.name)).toEqual(["Alpha", "Zeta"]);
  });

  test("a referredById that resolves to no loaded company is skipped", () => {
    expect(
      buildReferralLeaderboard([
        company({ id: "x", referredById: "gone" }),
      ]),
    ).toEqual([]);
  });
});
