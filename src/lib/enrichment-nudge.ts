import { NETWORK_STATUSES } from "@/lib/company-statuses";

// Proactive enrichment nudge (gap-audit cluster B, prototype Coterie.html:3066).
// PURE — no I/O — so the dashboard card's "these members have thin profiles"
// list is directly testable. The prototype tied this to fresh meeting data; the
// production model keeps it honest and self-contained: it flags in-network
// companies (members + strategic partners) whose network-facing fields are still
// blank, because those empties are what starve the intro engine and the AI
// briefs. Prospects and former relationships are out of scope — we only nudge to
// enrich the people the network actually works for.

export interface EnrichmentCandidate {
  id: string;
  name: string;
  status: string;
  website: string | null;
  lookingFor: string | null;
  canOffer: string | null;
  hasPrimaryContact: boolean;
}

export interface EnrichmentNudge {
  id: string;
  name: string;
  missingFields: string[];
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function buildEnrichmentNudges(
  companies: EnrichmentCandidate[],
): EnrichmentNudge[] {
  const nudges: EnrichmentNudge[] = [];
  for (const c of companies) {
    if (!NETWORK_STATUSES.includes(c.status)) continue;
    const missing: string[] = [];
    // Order matters — the intro engine leans hardest on the first two.
    if (isBlank(c.lookingFor)) missing.push("what they need");
    if (isBlank(c.canOffer)) missing.push("what they offer");
    if (isBlank(c.website)) missing.push("website");
    if (!c.hasPrimaryContact) missing.push("primary contact");
    if (missing.length > 0)
      nudges.push({ id: c.id, name: c.name, missingFields: missing });
  }
  // Most-incomplete first; name breaks ties so the list is stable across renders.
  nudges.sort(
    (a, b) =>
      b.missingFields.length - a.missingFields.length ||
      a.name.localeCompare(b.name),
  );
  return nudges;
}
