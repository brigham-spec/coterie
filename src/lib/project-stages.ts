// Canonical project pipeline vocabulary (spec §3.6, ported from the prototype's
// PROJECT_STAGES). Stage is a string field, not a table, but the app speaks one
// vocabulary — defined here once and reused by the board, the create/edit forms,
// and the dashboard's active-pipeline filter. Values are snake_case (the app
// convention); labels are the display form. `tone` maps to a design-token family
// (rendered to literal classes at the call site — Tailwind JIT needs full class
// strings, never built dynamically).

export type StageTone = "slate" | "purple" | "amber" | "gold" | "teal" | "red";

export type StageDef = { value: string; label: string; tone: StageTone };

export const PROJECT_STAGES: readonly StageDef[] = [
  { value: "concept", label: "Concept", tone: "slate" },
  { value: "pre_development", label: "Pre-Development", tone: "purple" },
  { value: "entitlements", label: "Entitlements", tone: "amber" },
  { value: "planning_board", label: "Planning Board", tone: "amber" },
  { value: "capital_raise", label: "Capital Raise", tone: "gold" },
  { value: "construction_docs", label: "Construction Docs", tone: "teal" },
  { value: "under_construction", label: "Under Construction", tone: "teal" },
  { value: "stabilization", label: "Stabilization", tone: "teal" },
  { value: "completed", label: "Completed", tone: "teal" },
  { value: "on_hold", label: "On Hold", tone: "red" },
];

/// Terminal stages — excluded from the active pipeline and shown apart on the
/// board (completed) or de-emphasized (on_hold).
export const TERMINAL_STAGES: readonly string[] = ["completed", "on_hold"];

/// The kanban columns: the active pipeline plus On Hold, in flow order.
/// Completed is surfaced separately (a finished project isn't "in" the pipeline).
export const BOARD_STAGES: readonly StageDef[] = PROJECT_STAGES.filter(
  (s) => s.value !== "completed",
);

const BY_VALUE: ReadonlyMap<string, StageDef> = new Map(
  PROJECT_STAGES.map((s) => [s.value, s]),
);

/// Resolve a stage value to its definition. Unknown values (legacy/evolving)
/// fall back to a neutral slate badge carrying the raw value as its label.
export function getStageDef(value: string): StageDef {
  return BY_VALUE.get(value) ?? { value, label: value, tone: "slate" };
}

/// Ordering rank for a stage (position in the pipeline); unknown stages sort last.
export function stageRank(value: string): number {
  const i = PROJECT_STAGES.findIndex((s) => s.value === value);
  return i === -1 ? PROJECT_STAGES.length : i;
}

/// Whether a value is a known project stage. Used at the write boundary to reject
/// forged/out-of-vocabulary values before they persist.
export function isProjectStage(value: string): boolean {
  return BY_VALUE.has(value);
}
