// Proposal follow-up nudge (gap-audit cluster B). Ported from the prototype's
// dashboard nudge (Coterie.html:3041): a membership proposal that is still open
// (not won/lost) and has gone more than a week without contact needs chasing. The
// "last contact" signal is the most recent of an explicit follow-up, else the send
// date, else when the proposal was created — so a draft that has sat untouched for
// over a week surfaces too. Pure — no I/O — so the shaping is unit-tested in
// isolation and the dashboard just renders the summary it returns.

const DAY = 86_400_000;

// A proposal untouched for more than this many days is surfaced for follow-up.
export const FOLLOW_UP_STALE_DAYS = 7;

// Terminal outcomes are settled and need no follow-up.
const CLOSED_STATUSES = new Set(["won", "lost"]);

export interface NudgeProposal {
  id: string;
  companyName: string;
  status: string;
  sentOn: Date | null;
  lastFollowUpAt: Date | null;
  createdAt: Date;
}

export interface StaleProposal {
  id: string;
  companyName: string;
  daysSinceContact: number;
}

export interface ProposalNudge {
  stale: StaleProposal[];
  oldestDays: number;
}

// Most recent moment this proposal was acted on. Every proposal has a createdAt,
// so this is never null.
function lastContactAt(p: NudgeProposal): Date {
  return p.lastFollowUpAt ?? p.sentOn ?? p.createdAt;
}

export function buildProposalNudge(
  proposals: NudgeProposal[],
  now: Date,
): ProposalNudge | null {
  const stale: StaleProposal[] = [];
  for (const p of proposals) {
    if (CLOSED_STATUSES.has(p.status)) continue;
    const days = Math.round(
      (now.getTime() - lastContactAt(p).getTime()) / DAY,
    );
    if (days > FOLLOW_UP_STALE_DAYS) {
      stale.push({
        id: p.id,
        companyName: p.companyName,
        daysSinceContact: days,
      });
    }
  }
  if (stale.length === 0) return null;
  // Most overdue first, so the dashboard headline names the worst offender.
  stale.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  return { stale, oldestDays: stale[0].daysSinceContact };
}
