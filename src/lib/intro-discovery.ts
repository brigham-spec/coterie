// PURE brand-new-intro discovery (gap-audit cluster A, the second half of the
// prototype's detectIntroActivity, Coterie.html:18308). Its sibling
// @/lib/intro-detection proposes ADVANCING an intro that already exists once a
// meeting brings both parties together; this one proposes CREATING an intro that
// doesn't exist yet — a meeting where two different member companies were in the
// room but no introduction has ever been logged between them.
//
// The prototype mined meeting titles + action-items by fuzzy name; the production
// model has real relations (an attendee's contact carries a companyId), so we
// pair at the company level off structured attendance and carry the actual people
// who represented each company so the operator can log the intro in one click.
// Nothing here writes; suppression is entirely derived (a pair with any logged
// introduction is already introduced), so once the operator logs one the pair
// drops from the list on the next load.

// How many candidates the panel shows at once — a bounded worklist, newest first.
export const MAX_NEW_INTRO_CANDIDATES = 12;

// How far back the loader scans meetings. Kept here so the discovery window is one
// source of truth alongside the pairing rule.
export const DISCOVERY_WINDOW_DAYS = 90;

/// One meeting attendee reduced to the person and the company they represent.
export type DiscoveryAttendee = {
  contactId: string;
  contactName: string;
  companyId: string;
  companyName: string;
};

/// A meeting reduced to who attended (each tagged with their company).
export type DiscoveryMeeting = {
  id: string;
  title: string;
  heldAt: Date;
  attendees: readonly DiscoveryAttendee[];
};

/// A company pair that already has a logged introduction — order-independent.
export type KnownPair = { aCompanyId: string; bCompanyId: string };

/// A proposed brand-new introduction awaiting a human's "Log intro". Carries the
/// representative contact for each side (so the intro can be created directly) and
/// the meeting that surfaced the opportunity. A/B are ordered by company name for
/// stable display.
export type NewIntroCandidate = {
  companyAId: string;
  companyAName: string;
  contactAId: string;
  contactAName: string;
  companyBId: string;
  companyBName: string;
  contactBId: string;
  contactBName: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: Date;
};

/// Order-independent key for a company pair, so (A,B) and (B,A) collide.
export function companyPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/// Scan meetings for company pairs that co-attended but have no introduction on
/// record, and propose creating one. A pair is emitted once — evidenced by its
/// most recent meeting — deduped across meetings, sorted newest first, and capped.
export function detectNewIntroCandidates(
  meetings: readonly DiscoveryMeeting[],
  existingPairs: readonly KnownPair[],
  maxCandidates = MAX_NEW_INTRO_CANDIDATES,
): NewIntroCandidate[] {
  const suppressed = new Set(
    existingPairs.map((p) => companyPairKey(p.aCompanyId, p.bCompanyId)),
  );
  // Best candidate per company pair, keeping the most recent evidencing meeting.
  const byPair = new Map<string, NewIntroCandidate>();

  for (const mtg of meetings) {
    // One representative attendee per company (first seen), so a company with
    // several people in the room still counts once.
    const reps = new Map<string, DiscoveryAttendee>();
    for (const a of mtg.attendees) {
      if (!reps.has(a.companyId)) reps.set(a.companyId, a);
    }
    // Need at least two distinct companies to form an introduction.
    if (reps.size < 2) continue;

    const companies = [...reps.values()];
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const [a, b] =
          companies[i].companyName.localeCompare(companies[j].companyName) <= 0
            ? [companies[i], companies[j]]
            : [companies[j], companies[i]];
        const key = companyPairKey(a.companyId, b.companyId);
        if (suppressed.has(key)) continue;

        const prev = byPair.get(key);
        if (prev && prev.meetingDate.getTime() >= mtg.heldAt.getTime()) continue;

        byPair.set(key, {
          companyAId: a.companyId,
          companyAName: a.companyName,
          contactAId: a.contactId,
          contactAName: a.contactName,
          companyBId: b.companyId,
          companyBName: b.companyName,
          contactBId: b.contactId,
          contactBName: b.contactName,
          meetingId: mtg.id,
          meetingTitle: mtg.title,
          meetingDate: mtg.heldAt,
        });
      }
    }
  }

  return [...byPair.values()]
    .sort((a, b) => b.meetingDate.getTime() - a.meetingDate.getTime())
    .slice(0, maxCandidates);
}
