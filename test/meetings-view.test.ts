import { describe, expect, test } from "vitest";

import {
  matchesMeetingFilters,
  meetingMemberFacets,
  meetingPreview,
  meetingStats,
  toMeetingView,
  type RawMeetingForView,
} from "@/lib/meetings-view";

// Pure-logic tests for the meetings workspace: member dedup, source derivation,
// stats, the keyword/source/member filters, and the collapsed-card preview.

function attendee(companyId: string, companyName: string) {
  return { contact: { company: { id: companyId, name: companyName } } };
}

function raw(over: Partial<RawMeetingForView>): RawMeetingForView {
  return {
    id: over.id ?? "m",
    title: over.title ?? "Sync",
    summary: over.summary ?? null,
    firefliesId: over.firefliesId ?? null,
    attendees: over.attendees ?? [],
  };
}

describe("toMeetingView", () => {
  test("dedupes members by company and marks source", () => {
    const v = toMeetingView(
      raw({
        firefliesId: "ff1",
        attendees: [
          attendee("co-b", "Beta"),
          attendee("co-a", "Alpha"),
          attendee("co-b", "Beta"),
        ],
      }),
    );
    expect(v.source).toBe("fireflies");
    expect(v.members.map((m) => m.name)).toEqual(["Alpha", "Beta"]);
  });

  test("a meeting with no firefliesId is manual", () => {
    expect(toMeetingView(raw({})).source).toBe("manual");
  });
});

describe("matchesMeetingFilters", () => {
  const v = toMeetingView(
    raw({
      title: "Q3 planning",
      summary: "Discussed the riverfront grant.",
      firefliesId: "ff1",
      attendees: [attendee("co-a", "Alpha")],
    }),
  );

  test("keyword matches title and summary", () => {
    expect(matchesMeetingFilters(v, { q: "riverfront", source: "", member: "" })).toBe(true);
    expect(matchesMeetingFilters(v, { q: "planning", source: "", member: "" })).toBe(true);
    expect(matchesMeetingFilters(v, { q: "merger", source: "", member: "" })).toBe(false);
  });

  test("source and member narrow the match", () => {
    expect(matchesMeetingFilters(v, { q: "", source: "manual", member: "" })).toBe(false);
    expect(matchesMeetingFilters(v, { q: "", source: "fireflies", member: "" })).toBe(true);
    expect(matchesMeetingFilters(v, { q: "", source: "", member: "co-a" })).toBe(true);
    expect(matchesMeetingFilters(v, { q: "", source: "", member: "co-z" })).toBe(false);
  });
});

describe("meetingStats / meetingMemberFacets", () => {
  const views = [
    toMeetingView(raw({ id: "1", firefliesId: "ff", attendees: [attendee("a", "Alpha")] })),
    toMeetingView(raw({ id: "2", attendees: [attendee("a", "Alpha"), attendee("b", "Beta")] })),
    toMeetingView(raw({ id: "3", firefliesId: "ff", attendees: [] })),
  ];

  test("counts total / fireflies / manual and distinct members", () => {
    const s = meetingStats(views);
    expect(s.total).toBe(3);
    expect(s.fireflies).toBe(2);
    expect(s.manual).toBe(1);
    expect(s.members).toBe(2);
  });

  test("member facets are distinct across meetings, sorted by name", () => {
    expect(meetingMemberFacets(views).map((m) => m.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("meetingPreview", () => {
  test("returns the first two sentences", () => {
    expect(
      meetingPreview("First point. Second point. Third point."),
    ).toBe("First point. Second point.");
  });

  test("returns the whole text when there is no sentence boundary", () => {
    expect(meetingPreview("no boundary here")).toBe("no boundary here");
  });

  test("is empty for a null or blank summary", () => {
    expect(meetingPreview(null)).toBe("");
    expect(meetingPreview("   ")).toBe("");
  });
});
