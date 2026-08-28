import { describe, expect, it } from "vitest";

import {
  oneGuestPerCompany,
  parseGuestSuggestions,
  type GuestCandidate,
  type SuggestedGuest,
} from "@/lib/event-guest-suggest";

// Unit tests for the PURE guest-suggestion helpers (S2 events part B). Guards the
// trust boundary the persisted picks rest on: every pick's contactId must be a
// supplied candidate (invented ids dropped, name re-attached from the roster),
// duplicates collapse, non-JSON/non-array responses yield [], and the final list
// collapses to one guest per company (favouring each firm's primary). No DB, no
// Anthropic.

const C_A = "aaaaaaaa-0000-0000-0000-000000000000";
const C_B = "bbbbbbbb-0000-0000-0000-000000000000";
const C_GHOST = "cccccccc-0000-0000-0000-000000000000";

function candidate(
  contactId: string,
  name: string,
  opts: { companyId?: string | null; isPrimary?: boolean } = {},
): GuestCandidate {
  return {
    contactId,
    name,
    company: "Acme Mills",
    companyId: opts.companyId === undefined ? "co-acme" : opts.companyId,
    isPrimary: opts.isPrimary ?? false,
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

// oneGuestPerCompany — spreads the list across distinct firms: at most one guest
// per company, preferring that company's PRIMARY contact so each represented firm
// sends its main relationship, not 3-4 people from the same company.
describe("oneGuestPerCompany", () => {
  const A_PRIMARY = candidate(C_A, "Ada Byron", { companyId: "co-a", isPrimary: true });
  const A_OTHER = candidate(C_B, "Ben Cole", { companyId: "co-a", isPrimary: false });
  const B_ONLY = candidate(C_GHOST, "Cid Doe", { companyId: "co-b", isPrimary: false });

  const pick = (contactId: string, reason: string): SuggestedGuest => {
    const name =
      [A_PRIMARY, A_OTHER, B_ONLY].find((c) => c.contactId === contactId)?.name ?? "";
    return { contactId, name, reason };
  };

  it("keeps only the first guest from a company, dropping later same-company picks", () => {
    const out = oneGuestPerCompany(
      [pick(C_A, "hosts the venue"), pick(C_B, "also at Acme")],
      [A_PRIMARY, A_OTHER],
    );
    expect(out).toEqual([{ contactId: C_A, name: "Ada Byron", reason: "hosts the venue" }]);
  });

  it("swaps a non-primary pick to the company's primary, carrying the reason", () => {
    const out = oneGuestPerCompany([pick(C_B, "raising capital")], [A_PRIMARY, A_OTHER]);
    expect(out).toEqual([{ contactId: C_A, name: "Ada Byron", reason: "raising capital" }]);
  });

  it("keeps the model's pick when the company has no primary on the roster", () => {
    const out = oneGuestPerCompany([pick(C_GHOST, "fits the theme")], [B_ONLY]);
    expect(out).toEqual([{ contactId: C_GHOST, name: "Cid Doe", reason: "fits the theme" }]);
  });

  it("spreads across companies — one primary from each", () => {
    const out = oneGuestPerCompany(
      [pick(C_B, "at Acme"), pick(C_GHOST, "at Beta")],
      [A_PRIMARY, A_OTHER, B_ONLY],
    );
    expect(out).toEqual([
      { contactId: C_A, name: "Ada Byron", reason: "at Acme" },
      { contactId: C_GHOST, name: "Cid Doe", reason: "at Beta" },
    ]);
  });

  it("never groups candidates with a null companyId", () => {
    const solo1 = candidate(C_A, "Ada Byron", { companyId: null });
    const solo2 = candidate(C_B, "Ben Cole", { companyId: null });
    const out = oneGuestPerCompany(
      [pick(C_A, "one"), pick(C_B, "two")],
      [solo1, solo2],
    );
    expect(out.map((g) => g.contactId)).toEqual([C_A, C_B]);
  });
});
