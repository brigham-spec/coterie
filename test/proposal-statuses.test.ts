import { describe, expect, test } from "vitest";

import {
  PROPOSAL_STATUSES,
  isProposalStatus,
} from "@/lib/proposal-statuses";

// The proposal vocabulary is the single source shared by the status select and
// the action write-boundary. Guard the exact tokens and the membership check.

describe("proposal statuses", () => {
  test("exposes the pipeline vocabulary in order", () => {
    expect(PROPOSAL_STATUSES).toEqual([
      "draft",
      "sent",
      "negotiating",
      "won",
      "lost",
    ]);
  });

  test("accepts known statuses and rejects everything else", () => {
    for (const s of PROPOSAL_STATUSES) expect(isProposalStatus(s)).toBe(true);
    expect(isProposalStatus("accepted")).toBe(false);
    expect(isProposalStatus("")).toBe(false);
    expect(isProposalStatus("WON")).toBe(false);
  });
});
