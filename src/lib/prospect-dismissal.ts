// Prospect-dismissal vocabulary (slice 11.6, Finder 16). When a user dismisses an
// externally-discovered prospect, we persist WHY (a small fixed taxonomy) so the
// same organisation isn't re-surfaced on the next search. The reason set mirrors the
// intro-engine's IntroDismissal taxonomy. Shared by the client dismiss picker
// (_finder.tsx) and the server action's write-boundary validation (actions.ts).
// A dismissal is keyed by the normalized org name because parseProspectTargets
// already excludes targets by lowercased org name — so a dismissed target is
// filtered for free by passing its name into excludeOrgs.

export type DismissReasonDef = { value: string; label: string };

export const PROSPECT_DISMISS_REASONS: readonly DismissReasonDef[] = [
  { value: "not_relevant", label: "Not relevant" },
  { value: "already_connected", label: "Already connected" },
  { value: "competitor", label: "Competitor" },
  { value: "wrong_timing", label: "Wrong timing" },
];

const REASON_VALUES = new Set(PROSPECT_DISMISS_REASONS.map((r) => r.value));

/// Whether a value is a known dismissal reason. Used at the write boundary to fall
/// back to "not_relevant" for forged/out-of-vocabulary values before they persist.
export function isDismissReason(value: string): boolean {
  return REASON_VALUES.has(value);
}

/// The dedupe key for a dismissed prospect — the normalized org name, matching how
/// parseProspectTargets excludes targets (trim + lowercase).
export function prospectDismissalKey(org: string): string {
  return org.trim().toLowerCase();
}
