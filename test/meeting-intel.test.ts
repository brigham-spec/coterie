import { describe, it, expect } from "vitest";

import {
  buildMeetingIntelContext,
  meetingIntelCutoff,
  type MeetingIntelEntry,
} from "@/lib/meeting-intel";

// Unit test for the introduction engine's meeting-intelligence condenser (S6c,
// item 14). Pure text shaping — guards the 30-day cutoff, the freshest-first
// ordering, the "re:" company attribution, the empty-summary drop, and the
// "" sentinel the caller uses to gate the "meeting intelligence active" badge.

function entry(over: Partial<MeetingIntelEntry>): MeetingIntelEntry {
  return {
    title: "Sync",
    heldAt: new Date("2026-07-20T00:00:00Z"),
    summary: "Discussed capital needs.",
    companyNames: [],
    ...over,
  };
}

describe("meetingIntelCutoff", () => {
  it("is 30 days before now", () => {
    const now = Date.UTC(2026, 6, 28);
    expect(meetingIntelCutoff(now).getTime()).toBe(now - 30 * 86_400_000);
  });
});

describe("buildMeetingIntelContext", () => {
  it("returns '' when no meeting carries a usable summary", () => {
    expect(buildMeetingIntelContext([])).toBe("");
    expect(
      buildMeetingIntelContext([
        entry({ summary: null }),
        entry({ summary: "   " }),
      ]),
    ).toBe("");
  });

  it("condenses meetings freshest-first with a count header and 're:' companies", () => {
    const ctx = buildMeetingIntelContext([
      entry({
        title: "Older",
        heldAt: new Date("2026-07-10T00:00:00Z"),
        summary: "Older discussion.",
        companyNames: ["Acme"],
      }),
      entry({
        title: "Newer",
        heldAt: new Date("2026-07-25T00:00:00Z"),
        summary: "Newer discussion.",
        companyNames: ["Beta", "Gamma"],
      }),
    ]);
    expect(ctx).toContain("RECENT MEETING INTELLIGENCE (last 30 days — 2 meetings):");
    // Freshest first.
    expect(ctx.indexOf("Newer")).toBeLessThan(ctx.indexOf("Older"));
    expect(ctx).toContain(`[2026-07-25] "Newer" — re: Beta, Gamma`);
    expect(ctx).toContain("Key discussion: Newer discussion.");
  });

  it("omits the 're:' clause when no companies are attributed", () => {
    const ctx = buildMeetingIntelContext([entry({ title: "Focus call" })]);
    expect(ctx).toContain(`[2026-07-20] "Focus call"\n`);
    expect(ctx).not.toContain("re:");
  });

  it("collapses whitespace and truncates a long summary", () => {
    const long = "word ".repeat(200);
    const ctx = buildMeetingIntelContext([entry({ summary: long })]);
    const line = ctx.split("\n").find((l) => l.startsWith("Key discussion:"))!;
    expect(line.length).toBeLessThanOrEqual("Key discussion: ".length + 250);
    expect(line).not.toContain("  ");
  });

  it("caps the block at 15 meetings", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      entry({
        title: `M${i}`,
        heldAt: new Date(Date.UTC(2026, 6, i + 1)),
        summary: `Summary ${i}.`,
      }),
    );
    const ctx = buildMeetingIntelContext(many);
    expect(ctx).toContain("— 15 meetings):");
  });
});
