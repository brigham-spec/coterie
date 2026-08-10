import { describe, expect, it } from "vitest";

import {
  companyPairKey,
  detectNewIntroCandidates,
  type DiscoveryAttendee,
  type DiscoveryMeeting,
  type KnownPair,
} from "@/lib/intro-discovery";

// Unit tests for the PURE brand-new-intro discoverer (gap-audit cluster A). Guards
// the rule the "Log intro" flow rests on: a candidate appears only when two member
// companies co-attended a meeting and NO introduction is on record between them;
// each pair is emitted once, evidenced by its most recent meeting, newest first.
// No DB, no Anthropic.

const CO_A = "aaaaaaaa-0000-0000-0000-000000000000";
const CO_B = "bbbbbbbb-0000-0000-0000-000000000000";
const CO_C = "cccccccc-0000-0000-0000-000000000000";

function person(
  companyId: string,
  companyName: string,
  contactId = `${companyName}-contact`,
  contactName = `${companyName} rep`,
): DiscoveryAttendee {
  return { contactId, contactName, companyId, companyName };
}

function meeting(
  id: string,
  heldAt: string,
  attendees: DiscoveryAttendee[],
  title = id,
): DiscoveryMeeting {
  return { id, title, heldAt: new Date(heldAt), attendees };
}

const acme = person(CO_A, "Acme");
const bolt = person(CO_B, "Bolt");
const cog = person(CO_C, "Cog");

describe("companyPairKey", () => {
  it("is order-independent", () => {
    expect(companyPairKey(CO_A, CO_B)).toBe(companyPairKey(CO_B, CO_A));
  });
});

describe("detectNewIntroCandidates", () => {
  it("proposes a new intro for two companies that co-attended and aren't yet introduced", () => {
    const out = detectNewIntroCandidates(
      [meeting("m1", "2026-02-01", [acme, bolt], "Kickoff")],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      companyAId: CO_A,
      companyBId: CO_B,
      contactAId: "Acme-contact",
      contactBId: "Bolt-contact",
      meetingId: "m1",
      meetingTitle: "Kickoff",
    });
  });

  it("suppresses a pair that already has a logged introduction (either direction)", () => {
    const existing: KnownPair[] = [{ aCompanyId: CO_B, bCompanyId: CO_A }];
    const out = detectNewIntroCandidates(
      [meeting("m1", "2026-02-01", [acme, bolt])],
      existing,
    );
    expect(out).toHaveLength(0);
  });

  it("ignores a meeting with only one company represented", () => {
    const out = detectNewIntroCandidates(
      [meeting("m1", "2026-02-01", [acme, person(CO_A, "Acme", "acme-2")])],
      [],
    );
    expect(out).toHaveLength(0);
  });

  it("emits every distinct pair from a three-company meeting", () => {
    const out = detectNewIntroCandidates(
      [meeting("m1", "2026-02-01", [acme, bolt, cog])],
      [],
    );
    expect(out).toHaveLength(3);
    const keys = out
      .map((c) => companyPairKey(c.companyAId, c.companyBId))
      .sort();
    expect(keys).toEqual(
      [
        companyPairKey(CO_A, CO_B),
        companyPairKey(CO_A, CO_C),
        companyPairKey(CO_B, CO_C),
      ].sort(),
    );
  });

  it("dedupes a pair across meetings, keeping the most recent as evidence", () => {
    const out = detectNewIntroCandidates(
      [
        meeting("early", "2026-02-01", [acme, bolt]),
        meeting("late", "2026-04-15", [acme, bolt]),
        meeting("mid", "2026-03-10", [acme, bolt]),
      ],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].meetingId).toBe("late");
  });

  it("orders each candidate's A/B by company name and returns newest meeting first", () => {
    const out = detectNewIntroCandidates(
      [
        meeting("m-older", "2026-02-01", [bolt, cog]),
        meeting("m-newer", "2026-05-01", [bolt, acme]),
      ],
      [],
    );
    expect(out.map((c) => c.meetingId)).toEqual(["m-newer", "m-older"]);
    // A/B ordered by company name (Acme < Bolt, Bolt < Cog), regardless of
    // attendee order in the meeting.
    expect(out[0]).toMatchObject({ companyAName: "Acme", companyBName: "Bolt" });
    expect(out[1]).toMatchObject({ companyAName: "Bolt", companyBName: "Cog" });
  });

  it("caps the list at maxCandidates, keeping the newest", () => {
    const meetings = [
      meeting("m1", "2026-01-01", [acme, bolt]),
      meeting("m2", "2026-02-01", [acme, cog]),
      meeting("m3", "2026-03-01", [bolt, cog]),
    ];
    const out = detectNewIntroCandidates(meetings, [], 2);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.meetingId)).toEqual(["m3", "m2"]);
  });
});
