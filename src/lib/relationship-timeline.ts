// Relationship timeline (member-profile enrichment, ported from the prototype's
// renderTimeline on the member modal, Coterie.html:6229). PURE — no I/O: given the
// raw relationship facts already loaded for a company (when it entered the CRM, the
// meetings its people attended, its introductions, and the commitments it has
// completed), merge them into one reverse-chronological history. The caller shapes
// each source inside its withOrg pass; this only sorts and labels, so it's fully
// unit-testable.

export type TimelineKind =
  | "added"
  | "meeting"
  | "intro"
  | "commitment"
  | "status";

export type TimelineEntry = {
  kind: TimelineKind;
  date: Date;
  label: string;
  detail: string | null;
};

export type TimelineMeeting = { title: string; heldAt: Date };

export type TimelineIntro = {
  partyAName: string;
  partyBName: string;
  status: string;
  outcome: string | null;
  date: Date;
};

export type TimelineCommitment = {
  text: string;
  // True when staff owed the deliverable ("we owe"); false when the member did.
  owedByUs: boolean;
  date: Date;
};

// A lifecycle transition (prospect → member → former). `from` is null for the
// very first status a company was created with.
export type TimelineStatusChange = {
  from: string | null;
  to: string;
  date: Date;
};

export type TimelineInput = {
  // When the company entered the CRM — the anchor at the bottom of the history.
  addedAt: Date;
  meetings: TimelineMeeting[];
  intros: TimelineIntro[];
  commitments: TimelineCommitment[];
  // Lifecycle transitions, from Activity rows. Optional: many companies have none.
  statusChanges?: TimelineStatusChange[];
};

const humanize = (v: string): string => v.replace(/_/g, " ");

/// PURE: merge every relationship fact into a single list sorted newest-first.
/// Ties break by a stable kind order so the output is deterministic. The "added"
/// anchor is always included; the other sources are included only where present.
export function buildRelationshipTimeline(input: TimelineInput): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({
    kind: "added",
    date: input.addedAt,
    label: "Added to the network",
    detail: null,
  });

  for (const m of input.meetings) {
    entries.push({
      kind: "meeting",
      date: m.heldAt,
      label: m.title,
      detail: "Meeting",
    });
  }

  for (const i of input.intros) {
    entries.push({
      kind: "intro",
      date: i.date,
      label: `${i.partyAName} ↔ ${i.partyBName}`,
      detail: i.outcome ? `Intro · ${i.outcome}` : "Intro",
    });
  }

  for (const c of input.commitments) {
    entries.push({
      kind: "commitment",
      date: c.date,
      label: c.text,
      detail: c.owedByUs ? "We delivered" : "They delivered",
    });
  }

  for (const s of input.statusChanges ?? []) {
    entries.push({
      kind: "status",
      date: s.date,
      label: `Became ${humanize(s.to)}`,
      detail: s.from ? `Status · from ${humanize(s.from)}` : "Status",
    });
  }

  // Stable order among same-timestamp entries so tests and UI don't flicker.
  const kindRank: Record<TimelineKind, number> = {
    meeting: 0,
    intro: 1,
    commitment: 2,
    status: 3,
    added: 4,
  };

  return entries.sort((a, b) => {
    const diff = b.date.getTime() - a.date.getTime();
    if (diff !== 0) return diff;
    return kindRank[a.kind] - kindRank[b.kind];
  });
}
