import { describe, it, expect } from "vitest";

import { parseGuestBriefs, type GuestContext } from "@/lib/event-brief";

// Unit test for the guest-brief PURE surface (slice 11.7). No Anthropic call —
// guards the defensive parser that turns a chatty model reply into per-guest bios:
// it must survive prose/fences, drop entries whose inviteeId isn't a supplied guest
// (no hallucinated guests), drop empty bios, re-attach names from the roster (not
// the model), dedupe per guest, and return [] for non-JSON / non-array input.

const guests: GuestContext[] = [
  {
    inviteeId: "inv-1",
    name: "Dana Rivers",
    org: "Hudson Timber",
    title: "Managing Partner",
    industry: "Construction",
    seeking: null,
    brings: null,
    focusAreas: [],
  },
  {
    inviteeId: "inv-2",
    name: "Sam Okafor",
    org: "Catskill Capital",
    title: "Principal",
    industry: "Finance",
    seeking: null,
    brings: null,
    focusAreas: [],
  },
];

describe("parseGuestBriefs", () => {
  it("parses a clean array and re-attaches names from the roster", () => {
    const raw = JSON.stringify([
      { inviteeId: "inv-1", bio: "Dana leads Hudson Timber." },
      { inviteeId: "inv-2", bio: "Sam runs Catskill Capital." },
    ]);
    const out = parseGuestBriefs(raw, guests);
    expect(out).toEqual([
      { inviteeId: "inv-1", name: "Dana Rivers", bio: "Dana leads Hudson Timber." },
      { inviteeId: "inv-2", name: "Sam Okafor", bio: "Sam runs Catskill Capital." },
    ]);
  });

  it("tolerates prose and markdown fences around the array", () => {
    const raw =
      'Here you go:\n```json\n[{"inviteeId":"inv-1","bio":"A short bio."}]\n```\nDone!';
    const out = parseGuestBriefs(raw, guests);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ inviteeId: "inv-1", bio: "A short bio." });
  });

  it("drops hallucinated guests not in the supplied roster", () => {
    const raw = JSON.stringify([
      { inviteeId: "inv-1", bio: "Real guest." },
      { inviteeId: "ghost", bio: "Invented guest." },
    ]);
    const out = parseGuestBriefs(raw, guests);
    expect(out.map((b) => b.inviteeId)).toEqual(["inv-1"]);
  });

  it("drops empty/whitespace bios and trims the rest", () => {
    const raw = JSON.stringify([
      { inviteeId: "inv-1", bio: "   " },
      { inviteeId: "inv-2", bio: "  Trim me.  " },
    ]);
    const out = parseGuestBriefs(raw, guests);
    expect(out).toEqual([
      { inviteeId: "inv-2", name: "Sam Okafor", bio: "Trim me." },
    ]);
  });

  it("keeps only the first bio per guest (dedupe)", () => {
    const raw = JSON.stringify([
      { inviteeId: "inv-1", bio: "First." },
      { inviteeId: "inv-1", bio: "Second." },
    ]);
    const out = parseGuestBriefs(raw, guests);
    expect(out).toEqual([
      { inviteeId: "inv-1", name: "Dana Rivers", bio: "First." },
    ]);
  });

  it("returns [] for non-JSON, non-array, or absent-array input", () => {
    expect(parseGuestBriefs("not json", guests)).toEqual([]);
    expect(parseGuestBriefs("{}", guests)).toEqual([]);
    expect(parseGuestBriefs('{"inviteeId":"inv-1","bio":"x"}', guests)).toEqual([]);
  });
});
