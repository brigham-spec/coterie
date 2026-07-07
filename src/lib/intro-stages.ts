// Canonical introduction lifecycle vocabulary (slice 11.4a, ported from the
// prototype's intro-log stages). An Introduction's `status` is a string field,
// not a table, but the app speaks one vocabulary — defined here once and reused
// by the ledger, the advance control, and (later) the engine's hand-off. Values
// are snake_case (the app convention); labels are the display form; `tone` maps
// to a design-token family, rendered to literal classes at the call site
// (Tailwind JIT needs full class strings, never built dynamically).

export type IntroTone = "slate" | "purple" | "amber" | "gold" | "teal" | "red";

export type IntroStageDef = { value: string; label: string; tone: IntroTone };

/// Pre-intro states — an introduction that has been suggested (by the engine or a
/// person) or drafted, but not yet actually made.
export const PRE_INTRO_STAGES: readonly IntroStageDef[] = [
  { value: "suggested", label: "Suggested", tone: "slate" },
  { value: "drafted", label: "Drafted", tone: "purple" },
];

/// The made-onward lifecycle — the prototype's intro-log progression. An intro
/// that concluded ends at value_created (it bore fruit) or dormant (it stalled).
export const INTRO_LIFECYCLE: readonly IntroStageDef[] = [
  { value: "made", label: "Made", tone: "amber" },
  { value: "connected", label: "Connected", tone: "amber" },
  { value: "meeting_set", label: "Meeting Set", tone: "gold" },
  { value: "collaborating", label: "Collaborating", tone: "teal" },
  { value: "value_created", label: "Value Created", tone: "teal" },
  { value: "dormant", label: "Dormant", tone: "red" },
];

/// The full ordered vocabulary: pre-intro states then the made-onward lifecycle.
export const INTRO_STAGES: readonly IntroStageDef[] = [
  ...PRE_INTRO_STAGES,
  ...INTRO_LIFECYCLE,
];

/// Terminal lifecycle stages — a concluded introduction (well or stalled).
export const TERMINAL_INTRO_STAGES: readonly string[] = [
  "value_created",
  "dormant",
];

const BY_VALUE: ReadonlyMap<string, IntroStageDef> = new Map(
  INTRO_STAGES.map((s) => [s.value, s]),
);

/// Resolve a status value to its definition. Unknown values (legacy/evolving)
/// fall back to a neutral slate badge carrying the raw value as its label.
export function getIntroStageDef(value: string): IntroStageDef {
  return BY_VALUE.get(value) ?? { value, label: value, tone: "slate" };
}

/// Ordering rank for a status (position in the lifecycle); unknown values sort last.
export function introStageRank(value: string): number {
  const i = INTRO_STAGES.findIndex((s) => s.value === value);
  return i === -1 ? INTRO_STAGES.length : i;
}

/// Map a pre-11.4 status value to the canonical lifecycle. The old vocabulary
/// was suggested/drafted/made/meeting_held/closed; meeting_held becomes the
/// meeting_set stage and closed becomes dormant (concluded, no asserted value).
/// Canonical values pass through unchanged, so this is safe to apply repeatedly.
const LEGACY_MAP: ReadonlyMap<string, string> = new Map([
  ["meeting_held", "meeting_set"],
  ["closed", "dormant"],
]);

export function normalizeIntroStatus(value: string): string {
  return LEGACY_MAP.get(value) ?? value;
}
