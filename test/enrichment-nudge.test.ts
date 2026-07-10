import { describe, expect, test } from "vitest";

import {
  buildEnrichmentNudges,
  type EnrichmentCandidate,
} from "@/lib/enrichment-nudge";

// Pure-logic tests for the enrichment nudge: only in-network companies are
// nudged, blank network fields are itemised, a fully-filled member drops out,
// and the list is ordered most-incomplete-first with a stable name tiebreak.

function candidate(over: Partial<EnrichmentCandidate>): EnrichmentCandidate {
  // Spread the overrides last so an explicit null/"" replaces the default (a
  // ?? merge would swallow those very values the blank-field cases test).
  return {
    id: "c1",
    name: "Acme",
    status: "member",
    website: "https://acme.test",
    lookingFor: "capital",
    canOffer: "distribution",
    hasPrimaryContact: true,
    ...over,
  };
}

describe("buildEnrichmentNudges", () => {
  test("a fully-populated member produces no nudge", () => {
    expect(buildEnrichmentNudges([candidate({})])).toEqual([]);
  });

  test("blank network fields are itemised in intro-engine priority order", () => {
    const nudges = buildEnrichmentNudges([
      candidate({
        website: "",
        lookingFor: null,
        canOffer: "  ",
        hasPrimaryContact: false,
      }),
    ]);
    expect(nudges).toHaveLength(1);
    expect(nudges[0].missingFields).toEqual([
      "what they need",
      "what they offer",
      "website",
      "primary contact",
    ]);
  });

  test("prospects and former relationships are never nudged", () => {
    const nudges = buildEnrichmentNudges([
      candidate({ id: "p", status: "prospect", lookingFor: null }),
      candidate({ id: "f", status: "former", canOffer: null }),
    ]);
    expect(nudges).toEqual([]);
  });

  test("strategic partners are in scope", () => {
    const nudges = buildEnrichmentNudges([
      candidate({ id: "sp", status: "strategic_partner", website: null }),
    ]);
    expect(nudges).toHaveLength(1);
    expect(nudges[0].missingFields).toEqual(["website"]);
  });

  test("orders most-incomplete first, then alphabetically", () => {
    const nudges = buildEnrichmentNudges([
      candidate({ id: "z", name: "Zeta", website: null }), // 1 missing
      candidate({
        id: "a",
        name: "Alpha",
        website: null,
        canOffer: null,
      }), // 2 missing
      candidate({ id: "b", name: "Beta", website: null }), // 1 missing
    ]);
    expect(nudges.map((n) => n.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });
});
