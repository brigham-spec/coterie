import { describe, expect, test } from "vitest";

import {
  buildRelationshipTimeline,
  type TimelineInput,
} from "@/lib/relationship-timeline";

// Unit coverage for the pure relationship-timeline merge (member-profile
// enrichment). Asserts the reverse-chronological ordering, the deterministic
// same-timestamp tiebreak, the always-present "added" anchor, and the label/
// detail shaping for each source kind.

const base: TimelineInput = {
  addedAt: new Date("2026-01-01T00:00:00Z"),
  meetings: [],
  intros: [],
  commitments: [],
};

describe("buildRelationshipTimeline", () => {
  test("always includes the 'added' anchor even with no other facts", () => {
    const out = buildRelationshipTimeline(base);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "added",
      date: base.addedAt,
      label: "Added to the network",
      detail: null,
    });
  });

  test("merges every source newest-first", () => {
    const out = buildRelationshipTimeline({
      addedAt: new Date("2026-01-01T00:00:00Z"),
      meetings: [{ title: "Kickoff", heldAt: new Date("2026-03-01T00:00:00Z") }],
      intros: [
        {
          partyAName: "Alice",
          partyBName: "Bob",
          status: "made",
          outcome: "warm",
          date: new Date("2026-05-01T00:00:00Z"),
        },
      ],
      commitments: [
        { text: "Send deck", owedByUs: true, date: new Date("2026-04-01T00:00:00Z") },
      ],
    });

    expect(out.map((e) => e.kind)).toEqual([
      "intro", // May
      "commitment", // Apr
      "meeting", // Mar
      "added", // Jan (anchor, always last here)
    ]);
  });

  test("shapes each kind's label and detail", () => {
    const out = buildRelationshipTimeline({
      addedAt: new Date("2026-01-01T00:00:00Z"),
      meetings: [{ title: "Coffee", heldAt: new Date("2026-02-01T00:00:00Z") }],
      intros: [
        {
          partyAName: "Alice",
          partyBName: "Bob",
          status: "made",
          outcome: null,
          date: new Date("2026-02-02T00:00:00Z"),
        },
      ],
      commitments: [
        { text: "Intro them", owedByUs: false, date: new Date("2026-02-03T00:00:00Z") },
      ],
    });

    const byKind = Object.fromEntries(out.map((e) => [e.kind, e]));
    expect(byKind.meeting).toMatchObject({ label: "Coffee", detail: "Meeting" });
    expect(byKind.intro).toMatchObject({ label: "Alice ↔ Bob", detail: "Intro" });
    expect(byKind.commitment).toMatchObject({
      label: "Intro them",
      detail: "They delivered",
    });
  });

  test("labels intro outcome and commitment side", () => {
    const out = buildRelationshipTimeline({
      addedAt: new Date("2026-01-01T00:00:00Z"),
      meetings: [],
      intros: [
        {
          partyAName: "Alice",
          partyBName: "Bob",
          status: "made",
          outcome: "deal signed",
          date: new Date("2026-06-01T00:00:00Z"),
        },
      ],
      commitments: [
        { text: "Wire funds", owedByUs: true, date: new Date("2026-05-01T00:00:00Z") },
      ],
    });

    const intro = out.find((e) => e.kind === "intro")!;
    const commitment = out.find((e) => e.kind === "commitment")!;
    expect(intro.detail).toBe("Intro · deal signed");
    expect(commitment.detail).toBe("We delivered");
  });

  test("breaks same-timestamp ties by stable kind rank (meeting<intro<commitment<status<added)", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const out = buildRelationshipTimeline({
      addedAt: same,
      meetings: [{ title: "M", heldAt: same }],
      intros: [
        { partyAName: "A", partyBName: "B", status: "made", outcome: null, date: same },
      ],
      commitments: [{ text: "C", owedByUs: true, date: same }],
      statusChanges: [{ from: "prospect", to: "member", date: same }],
    });
    expect(out.map((e) => e.kind)).toEqual([
      "meeting",
      "intro",
      "commitment",
      "status",
      "added",
    ]);
  });

  test("shapes a status change's label and detail, humanizing the status", () => {
    const out = buildRelationshipTimeline({
      ...base,
      statusChanges: [
        {
          from: "prospect",
          to: "strategic_partner",
          date: new Date("2026-04-01T00:00:00Z"),
        },
      ],
    });
    const status = out.find((e) => e.kind === "status")!;
    expect(status).toMatchObject({
      label: "Became strategic partner",
      detail: "Status · from prospect",
    });
  });

  test("labels an initial status (no 'from') without the transition detail", () => {
    const out = buildRelationshipTimeline({
      ...base,
      statusChanges: [
        { from: null, to: "member", date: new Date("2026-04-01T00:00:00Z") },
      ],
    });
    const status = out.find((e) => e.kind === "status")!;
    expect(status).toMatchObject({ label: "Became member", detail: "Status" });
  });

  test("shapes a note, carrying its id and attributing the author", () => {
    const out = buildRelationshipTimeline({
      ...base,
      notes: [
        {
          id: "note-1",
          body: "Called about Q3",
          authorName: "Dana",
          date: new Date("2026-03-15T00:00:00Z"),
        },
      ],
    });
    const note = out.find((e) => e.kind === "note")!;
    expect(note).toMatchObject({
      label: "Called about Q3",
      detail: "Note · Dana",
      noteId: "note-1",
    });
  });

  test("a note with no author drops the attribution", () => {
    const out = buildRelationshipTimeline({
      ...base,
      notes: [
        {
          id: "note-2",
          body: "Reminder to follow up",
          authorName: null,
          date: new Date("2026-03-15T00:00:00Z"),
        },
      ],
    });
    expect(out.find((e) => e.kind === "note")!.detail).toBe("Note");
  });

  test("only notes carry a noteId; derived facts do not", () => {
    const out = buildRelationshipTimeline({
      ...base,
      meetings: [{ title: "M", heldAt: new Date("2026-02-01T00:00:00Z") }],
      notes: [
        {
          id: "note-3",
          body: "N",
          authorName: null,
          date: new Date("2026-02-02T00:00:00Z"),
        },
      ],
    });
    expect(out.find((e) => e.kind === "note")!.noteId).toBe("note-3");
    expect(out.find((e) => e.kind === "meeting")!.noteId).toBeUndefined();
  });

  test("shapes value, event, and news sources", () => {
    const out = buildRelationshipTimeline({
      ...base,
      values: [
        {
          summary: "Grant secured",
          outcome: "$50k",
          date: new Date("2026-02-01T00:00:00Z"),
        },
      ],
      events: [{ name: "Spring Dinner", date: new Date("2026-02-02T00:00:00Z") }],
      news: [{ headline: "Ribbon cutting", date: new Date("2026-02-03T00:00:00Z") }],
    });
    const byKind = Object.fromEntries(out.map((e) => [e.kind, e]));
    expect(byKind.value).toMatchObject({
      label: "Grant secured",
      detail: "Value delivered · $50k",
    });
    expect(byKind.event).toMatchObject({
      label: "Spring Dinner",
      detail: "Attended event",
    });
    expect(byKind.news).toMatchObject({
      label: "Ribbon cutting",
      detail: "News",
    });
  });

  test("a value with no outcome keeps the bare label", () => {
    const out = buildRelationshipTimeline({
      ...base,
      values: [
        {
          summary: "Service rendered",
          outcome: null,
          date: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    });
    expect(out.find((e) => e.kind === "value")!.detail).toBe("Value delivered");
  });

  test("breaks same-timestamp ties across every kind deterministically", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const out = buildRelationshipTimeline({
      addedAt: same,
      meetings: [{ title: "M", heldAt: same }],
      intros: [
        { partyAName: "A", partyBName: "B", status: "made", outcome: null, date: same },
      ],
      commitments: [{ text: "C", owedByUs: true, date: same }],
      statusChanges: [{ from: "prospect", to: "member", date: same }],
      values: [{ summary: "V", outcome: null, date: same }],
      events: [{ name: "E", date: same }],
      news: [{ headline: "N", date: same }],
      notes: [{ id: "n", body: "note", authorName: null, date: same }],
    });
    expect(out.map((e) => e.kind)).toEqual([
      "meeting",
      "intro",
      "commitment",
      "value",
      "event",
      "news",
      "note",
      "status",
      "added",
    ]);
  });
});
