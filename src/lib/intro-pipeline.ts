// Introductions pipeline shaping (S6a, ported from the prototype's introductions
// funnel + stage-filter + stale warnings, Coterie.html:11831). PURE derived logic
// over the ledger rows — the page loads introductions withOrg and hands them here
// to build the funnel counts, the stage-filter chips, and the >30-day stale flag.
// No I/O, so the ordering/thresholds are unit-tested.

import {
  INTRO_LIFECYCLE,
  INTRO_STAGES,
  TERMINAL_INTRO_STAGES,
  type IntroStageDef,
} from "@/lib/intro-stages";

const DAY = 86_400_000;

// An introduction is "stalled" if it has sat in a non-terminal stage past this
// many days without advancing (parity: STALE_DAYS = 30).
export const PIPELINE_STALE_DAYS = 30;

// The connection-type taxonomy the intro-log form offers (parity: the prototype's
// Connection Type select). Free-text "" means unset; the write boundary accepts
// only these labels or "".
export const INTRO_CONNECTION_TYPES = [
  "Deal Flow",
  "Agency Navigation",
  "Peer Relationship",
  "Project Partnership",
  "Business Development",
  "Capital & Financing",
  "Community Anchor",
  "Other",
] as const;

const CONNECTION_TYPE_SET: ReadonlySet<string> = new Set(INTRO_CONNECTION_TYPES);

/// Whether a value is a known connection type (or "" for unset). Used at the
/// write boundary to reject a forged/out-of-vocabulary label before it persists.
export function isConnectionType(value: string): boolean {
  return value === "" || CONNECTION_TYPE_SET.has(value);
}

/// The row shape the pipeline reasons over — just a status and the last time it
/// moved. `updatedAt` stands in for the prototype's per-entry lastActivity: it is
/// the last time the row (its stage/outcome) changed, so days-in-stage is days
/// since that write.
export interface PipelineIntro {
  status: string;
  updatedAt: Date;
}

/// Whole days a row has sat since it last changed (floored). Both anchors are
/// wall-clock instants, so a plain millisecond delta is correct here (unlike the
/// UTC-calendar due-date math elsewhere).
export function daysInStage(updatedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / DAY);
}

/// A row is stale when it is in a non-terminal stage and hasn't moved in more than
/// PIPELINE_STALE_DAYS. Terminal stages (value_created / dormant) never go stale —
/// they've concluded.
export function isIntroStale(status: string, updatedAt: Date, now: Date): boolean {
  if (TERMINAL_INTRO_STAGES.includes(status)) return false;
  return daysInStage(updatedAt, now) > PIPELINE_STALE_DAYS;
}

export interface FunnelCell extends IntroStageDef {
  count: number;
}

/// Tally how many rows sit in each status — the shared count map the funnel and
/// the stage chips both read.
function tallyByStatus(intros: readonly { status: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of intros) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  return counts;
}

/// The funnel bar: one cell per made-onward lifecycle stage (pre-intro states are
/// not part of the funnel) with how many rows currently sit in it. Order follows
/// INTRO_LIFECYCLE so the bar reads left-to-right along the lifecycle.
export function pipelineFunnel(intros: readonly { status: string }[]): FunnelCell[] {
  const counts = tallyByStatus(intros);
  return INTRO_LIFECYCLE.map((s) => ({ ...s, count: counts.get(s.value) ?? 0 }));
}

/// Conversion rate: share of all introductions that reached value_created,
/// rounded to a whole percent. 0 when there are no introductions.
export function conversionRate(intros: readonly { status: string }[]): number {
  if (intros.length === 0) return 0;
  const won = intros.filter((i) => i.status === "value_created").length;
  return Math.round((won / intros.length) * 100);
}

export interface StageChip {
  /// "" is the "All" chip; otherwise a stage value.
  value: string;
  label: string;
  count: number;
}

/// The stage-filter chips: an "All" chip, then one chip per stage that actually
/// has rows (parity: hide empty stages). Chips follow the canonical stage order.
export function stageChips(intros: readonly { status: string }[]): StageChip[] {
  const counts = tallyByStatus(intros);
  const chips: StageChip[] = [{ value: "", label: "All", count: intros.length }];
  for (const s of INTRO_STAGES) {
    const count = counts.get(s.value) ?? 0;
    if (count > 0) chips.push({ value: s.value, label: s.label, count });
  }
  return chips;
}

/// Filter the ledger to a single stage; an empty/unknown value keeps everything
/// (the "All" view).
export function filterByStage<T extends { status: string }>(
  intros: readonly T[],
  stage: string,
): T[] {
  if (stage === "" || !INTRO_STAGES.some((s) => s.value === stage)) {
    return [...intros];
  }
  return intros.filter((i) => i.status === stage);
}
