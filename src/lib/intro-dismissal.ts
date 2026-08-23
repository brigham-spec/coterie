// Intro-dismissal vocabulary. When a user dispositions a scanned pairing on the
// dashboard's "Possible Introductions" panel, we persist WHY (a small fixed
// taxonomy) onto IntroDismissal.reason so the same pair isn't re-surfaced on the
// next scan and the operator has a record of the call they made. Shared by the
// client disposition picker (_intro-scan.tsx) and the server action's
// write-boundary validation (dismissIntro in companies/[id]/actions.ts).
//
// Distinct from the prospect taxonomy (prospect-dismissal.ts): an intro pairing
// is between two companies already in the network, so "already connected" makes
// no sense here — instead we offer a free-form "Other" for calls that don't fit
// the fixed reasons. IntroDismissal.reason is a plain String column, so "other"
// needs no migration.

import type { DismissReasonDef } from "./prospect-dismissal";

export const INTRO_DISMISS_REASONS: readonly DismissReasonDef[] = [
  { value: "not_relevant", label: "Not relevant" },
  { value: "competitor", label: "Competitor" },
  { value: "wrong_timing", label: "Wrong timing" },
  { value: "other", label: "Other" },
];

const REASON_VALUES = new Set(INTRO_DISMISS_REASONS.map((r) => r.value));

/// Whether a value is a known intro-dismissal reason. Used at the write boundary
/// to fall back to "not_relevant" for forged/out-of-vocabulary values.
export function isIntroDismissReason(value: string): boolean {
  return REASON_VALUES.has(value);
}
