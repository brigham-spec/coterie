import { describe, expect, it } from "vitest";

import {
  parseGuestSuggestions,
  type GuestCandidate,
} from "@/lib/event-guest-suggest";

// Unit tests for the PURE guest-suggestion parser (S2 events part B). Guards the
// trust boundary the persisted picks rest on: every pick's contactId must be a
// supplied candidate (invented ids dropped, name re-attached from the roster),
// duplicates collapse, and non-JSON/non-array responses yield []. No DB, no
// Anthropic.

const C_A = "aaaaaaaa-0000-0000-0000-000000000000";
const C_B = "bbbbbbbb-0000-0000-0000-000000000000";
const C_GHOST = "cccccccc-0000-0000-0000-000000000000";

function candidate(contactId: string, name: string): GuestCandidate {
  return {
    contactId,
    name,
    company: "Acme Mills",
    industry: "Legal",
    lookingFor: null,
    canOffer: null,
    tags: [],
    neverInvited: false,
  };
}

const roster = [candidate(C_A, "Ada Byron"), candidate(C_B, "Ben Cole")];

function wrap(picks: unknown[]): string {
  return `Sure — here you go:\n${JSON.stringify(picks)}\nLet me know.`;
}

describe("parseGuestSuggestions", () => {
  it("parses well-formed picks, re-attaching names from the roster", () => {
    const out = parseGuestSuggestions(
      wrap([
        { contactId: C_A, reason: "hosting the venue" },
        { contactId: C_B, reason: "raising capital now" },
      ]),
      roster,
    );
    expect(out).toEqual([
      { contactId: C_A, name: "Ada Byron", reason: "hosting the venue" },
      { contactId: C_B, name: "Ben Cole", reason: "raising capital now" },
    ]);
  });

  it("drops picks whose contactId is not a supplied candidate", () => {
    const out = parseGuestSuggestions(
      wrap([
        { contactId: C_GHOST, reason: "invented" },
        { contactId: C_A, reason: "real" },
      ]),
      roster,
    );
    expect(out).toEqual([
      { contactId: C_A, name: "Ada Byron", reason: "real" },
    ]);
  });

  it("collapses duplicate contactIds, keeping the first", () => {
    const out = parseGuestSuggestions(
      wrap([
        { contactId: C_A, reason: "first" },
        { contactId: C_A, reason: "second" },
      ]),
      roster,
    );
    expect(out).toEqual([
      { contactId: C_A, name: "Ada Byron", reason: "first" },
    ]);
  });

  it("defaults a missing reason to an empty string", () => {
    const out = parseGuestSuggestions(wrap([{ contactId: C_A }]), roster);
    expect(out).toEqual([{ contactId: C_A, name: "Ada Byron", reason: "" }]);
  });

  it("returns [] for non-JSON, non-array, or empty responses", () => {
    expect(parseGuestSuggestions("no json here", roster)).toEqual([]);
    expect(parseGuestSuggestions(JSON.stringify({ contactId: C_A }), roster)).toEqual([]);
    expect(parseGuestSuggestions("", roster)).toEqual([]);
  });
});
