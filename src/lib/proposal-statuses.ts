// Canonical membership-proposal lifecycle vocabulary. A MembershipProposal's
// `status` is a string column, not a table, but the app speaks one vocabulary —
// defined here once and reused by the proposals card's status select and the
// write-boundary validation in the server actions. Values are the same tokens
// the schema documents (draft, sent, negotiating, won, lost); labels are the
// display form. Badge colors live in @/components/ui StatusBadge (keyed by these
// same values). "won" / "lost" are the terminal outcomes — @/lib/revenue and
// @/lib/proposal-nudge both treat everything else as open pipeline.

export type ProposalStatusDef = { value: string; label: string };

export const PROPOSAL_STATUS_DEFS: readonly ProposalStatusDef[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "negotiating", label: "Negotiating" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export const PROPOSAL_STATUSES: readonly string[] = PROPOSAL_STATUS_DEFS.map(
  (s) => s.value,
);

const VALUES = new Set(PROPOSAL_STATUSES);

/// Whether a value is a known proposal status. Used at the write boundary to
/// reject forged/out-of-vocabulary values before they persist.
export function isProposalStatus(value: string): boolean {
  return VALUES.has(value);
}
