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
  | "status"
  | "note"
  | "value"
  | "event"
  | "news";

export type TimelineEntry = {
  kind: TimelineKind;
  date: Date;
  label: string;
  detail: string | null;
  // Set only on manual notes — the one editable/deletable source. Carries the
  // Note.id so the profile can offer inline edit/delete; null for derived facts.
  noteId?: string;
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

// A manual note authored on the profile — the one editable timeline source.
export type TimelineNote = {
  id: string;
  body: string;
  // The author's name, when the note still has an author (null once deleted).
  authorName: string | null;
  date: Date;
};

// A recorded win from the Value Delivered ledger.
export type TimelineValue = {
  summary: string;
  outcome: string | null;
  date: Date;
};

// An event this company's people attended (caller filters to attendance).
export type TimelineEvent = {
  name: string;
  date: Date;
};

// A saved news touchpoint for this company.
export type TimelineNews = {
  headline: string;
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
  // Additional touchpoints (item 24), all optional: manual notes, delivered
  // value, attended events, and saved news.
  notes?: TimelineNote[];
  values?: TimelineValue[];
  events?: TimelineEvent[];
  news?: TimelineNews[];
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

  for (const n of input.notes ?? []) {
    entries.push({
      kind: "note",
      date: n.date,
      label: n.body,
      detail: n.authorName ? `Note · ${n.authorName}` : "Note",
      noteId: n.id,
    });
  }

  for (const v of input.values ?? []) {
    entries.push({
      kind: "value",
      date: v.date,
      label: v.summary,
      detail: v.outcome ? `Value delivered · ${v.outcome}` : "Value delivered",
    });
  }

  for (const e of input.events ?? []) {
    entries.push({
      kind: "event",
      date: e.date,
      label: e.name,
      detail: "Attended event",
    });
  }

  for (const n of input.news ?? []) {
    entries.push({
      kind: "news",
      date: n.date,
      label: n.headline,
      detail: "News",
    });
  }

  // Stable order among same-timestamp entries so tests and UI don't flicker.
  const kindRank: Record<TimelineKind, number> = {
    meeting: 0,
    intro: 1,
    commitment: 2,
    value: 3,
    event: 4,
    news: 5,
    note: 6,
    status: 7,
    added: 8,
  };

  return entries.sort((a, b) => {
    const diff = b.date.getTime() - a.date.getTime();
    if (diff !== 0) return diff;
    return kindRank[a.kind] - kindRank[b.kind];
  });
}
