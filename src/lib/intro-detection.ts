// Pending intro-advance detection (gap-audit cluster A, ported from the
// prototype's detectIntroActivity, Coterie.html:18308). PURE and deterministic —
// no DB, no AI. Given the org's in-flight introductions and its meetings (each
// reduced to the set of companies whose people attended), it proposes advancing
// an introduction whenever a meeting held AFTER the intro was made brought BOTH
// parties' companies to the same table. Those proposals are surfaced for a human
// to confirm before the ledger stage actually moves — nothing here writes.
//
// The prototype matched parties to meeting participants by fuzzy email/name; the
// production model has real relations (an attendee's contact carries a companyId),
// so the match is exact at the company level: a qualifying meeting contains at
// least one attendee from party A's company AND one from party B's.

import { introStageRank } from "./intro-stages";

/// The single stage a detection proposes advancing to — evidence of a meeting
/// between the parties means the introduction has, at minimum, been Met.
export const SUGGESTED_ADVANCE_STAGE = "meeting_set";

const MADE_RANK = introStageRank("made");
const MEETING_SET_RANK = introStageRank(SUGGESTED_ADVANCE_STAGE);

/// Only introductions that have been made but not yet advanced to meeting_set are
/// candidates: a meeting is evidence they met, which is meaningless once already
/// at/past that stage, and premature for a still-suggested/drafted pairing.
export function isDetectableStage(status: string): boolean {
  const r = introStageRank(status);
  return r >= MADE_RANK && r < MEETING_SET_RANK;
}

/// An in-flight introduction reduced to what detection needs. `since` is the
/// reference instant a confirming meeting must fall after (the intro's made date,
/// or its creation instant when no made date was recorded).
export type DetectableIntro = {
  id: string;
  status: string;
  since: Date;
  partyACompanyId: string;
  partyBCompanyId: string;
  partyALabel: string;
  partyBLabel: string;
};

/// A meeting reduced to the set of companies whose people attended it.
export type DetectionMeeting = {
  id: string;
  title: string;
  heldAt: Date;
  companyIds: ReadonlySet<string>;
};

/// A proposed advance awaiting human confirmation. Carries the party company ids
/// so a caller can scope detections to one company's profile, and the evidencing
/// meeting so the operator can judge the proposal.
export type PendingIntroDetection = {
  introId: string;
  partyACompanyId: string;
  partyBCompanyId: string;
  partyALabel: string;
  partyBLabel: string;
  currentStage: string;
  suggestedStage: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: Date;
};

/// For each detectable introduction, find the most recent meeting held after it
/// was made that brought both parties' companies together, and emit a proposal to
/// advance it. Results are sorted by evidencing-meeting date, newest first.
export function detectPendingIntroAdvances(
  intros: readonly DetectableIntro[],
  meetings: readonly DetectionMeeting[],
): PendingIntroDetection[] {
  const detections: PendingIntroDetection[] = [];

  for (const intro of intros) {
    if (!isDetectableStage(intro.status)) continue;
    // A single-company pairing can't be evidenced by "both attended" — any one of
    // that company's meetings would trivially match. Skip to avoid false positives.
    if (intro.partyACompanyId === intro.partyBCompanyId) continue;

    let best: DetectionMeeting | null = null;
    for (const mtg of meetings) {
      if (mtg.heldAt <= intro.since) continue;
      if (
        !mtg.companyIds.has(intro.partyACompanyId) ||
        !mtg.companyIds.has(intro.partyBCompanyId)
      )
        continue;
      if (best == null || mtg.heldAt > best.heldAt) best = mtg;
    }
    if (best == null) continue;

    detections.push({
      introId: intro.id,
      partyACompanyId: intro.partyACompanyId,
      partyBCompanyId: intro.partyBCompanyId,
      partyALabel: intro.partyALabel,
      partyBLabel: intro.partyBLabel,
      currentStage: intro.status,
      suggestedStage: SUGGESTED_ADVANCE_STAGE,
      meetingId: best.id,
      meetingTitle: best.title,
      meetingDate: best.heldAt,
    });
  }

  detections.sort((a, b) => b.meetingDate.getTime() - a.meetingDate.getTime());
  return detections;
}
