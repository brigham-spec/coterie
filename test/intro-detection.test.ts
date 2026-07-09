import { describe, expect, it } from "vitest";

import {
  detectPendingIntroAdvances,
  isDetectableStage,
  SUGGESTED_ADVANCE_STAGE,
  type DetectableIntro,
  type DetectionMeeting,
} from "@/lib/intro-detection";

// Unit tests for the PURE pending intro-advance detector (gap-audit cluster A).
// Guards the rule the human confirmation flow rests on: a proposal appears only
// when a meeting held AFTER an in-flight intro was made brought BOTH parties'
// companies together, the most recent such meeting is the evidence, and results
// come back newest-first. No DB, no Anthropic.

const CO_A = "aaaaaaaa-0000-0000-0000-000000000000";
const CO_B = "bbbbbbbb-0000-0000-0000-000000000000";
const CO_C = "cccccccc-0000-0000-0000-000000000000";

function intro(over: Partial<DetectableIntro> = {}): DetectableIntro {
  return {
    id: "intro-1",
    status: "made",
    since: new Date("2026-01-01"),
    partyACompanyId: CO_A,
    partyBCompanyId: CO_B,
    partyALabel: "Acme",
    partyBLabel: "Bolt",
    ...over,
  };
}

function meeting(
  id: string,
  heldAt: string,
  companyIds: string[],
  title = id,
): DetectionMeeting {
  return { id, title, heldAt: new Date(heldAt), companyIds: new Set(companyIds) };
}

describe("isDetectableStage", () => {
  it("accepts made and connected, rejects pre-intro, meeting_set, and terminal", () => {
    expect(isDetectableStage("made")).toBe(true);
    expect(isDetectableStage("connected")).toBe(true);
    expect(isDetectableStage("suggested")).toBe(false);
    expect(isDetectableStage("drafted")).toBe(false);
    expect(isDetectableStage("meeting_set")).toBe(false);
    expect(isDetectableStage("value_created")).toBe(false);
    expect(isDetectableStage("dormant")).toBe(false);
  });
});

describe("detectPendingIntroAdvances", () => {
  it("proposes an advance when a later meeting has both parties' companies", () => {
    const out = detectPendingIntroAdvances(
      [intro()],
      [meeting("m1", "2026-02-01", [CO_A, CO_B], "Kickoff")],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      introId: "intro-1",
      suggestedStage: SUGGESTED_ADVANCE_STAGE,
      currentStage: "made",
      meetingId: "m1",
      meetingTitle: "Kickoff",
    });
  });

  it("ignores meetings held on or before the intro was made", () => {
    const out = detectPendingIntroAdvances(
      [intro({ since: new Date("2026-02-01") })],
      [meeting("m1", "2026-02-01", [CO_A, CO_B])], // exactly at `since` → excluded
    );
    expect(out).toHaveLength(0);
  });

  it("ignores meetings missing one of the two parties", () => {
    const out = detectPendingIntroAdvances(
      [intro()],
      [meeting("m1", "2026-03-01", [CO_A, CO_C])],
    );
    expect(out).toHaveLength(0);
  });

  it("skips introductions not in a detectable stage", () => {
    const out = detectPendingIntroAdvances(
      [intro({ status: "meeting_set" }), intro({ status: "suggested", id: "x" })],
      [meeting("m1", "2026-02-01", [CO_A, CO_B])],
    );
    expect(out).toHaveLength(0);
  });

  it("skips a self-pairing (both parties at the same company)", () => {
    const out = detectPendingIntroAdvances(
      [intro({ partyBCompanyId: CO_A })],
      [meeting("m1", "2026-02-01", [CO_A])],
    );
    expect(out).toHaveLength(0);
  });

  it("picks the most recent qualifying meeting as the evidence", () => {
    const out = detectPendingIntroAdvances(
      [intro()],
      [
        meeting("early", "2026-02-01", [CO_A, CO_B]),
        meeting("late", "2026-04-15", [CO_A, CO_B]),
        meeting("mid", "2026-03-10", [CO_A, CO_B]),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].meetingId).toBe("late");
  });

  it("returns detections newest evidencing-meeting first", () => {
    const older = intro({
      id: "older",
      partyACompanyId: CO_A,
      partyBCompanyId: CO_C,
      partyBLabel: "Cog",
    });
    const newer = intro({ id: "newer" });
    const out = detectPendingIntroAdvances(
      [older, newer],
      [
        meeting("m-older", "2026-02-01", [CO_A, CO_C]),
        meeting("m-newer", "2026-05-01", [CO_A, CO_B]),
      ],
    );
    expect(out.map((d) => d.introId)).toEqual(["newer", "older"]);
  });
});
