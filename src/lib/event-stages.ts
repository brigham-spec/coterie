// Canonical event vocabulary (slice 11.7, ported from the prototype's eventsView /
// eventModal). Type, stage, and RSVP are string fields, not tables, but the app
// speaks one vocabulary — defined here once and reused by the list, the create/edit
// forms, and the guest list. Values are snake_case (the app convention); labels are
// the display form. `tone` maps to a design-token family (rendered to literal
// classes at the call site — Tailwind JIT needs full class strings, never built
// dynamically).

export type EventTone = "slate" | "purple" | "amber" | "gold" | "teal" | "red";

export type EventDef = { value: string; label: string; tone: EventTone };

/// What kind of gathering it is (demo eventModal type select).
export const EVENT_TYPES: readonly EventDef[] = [
  { value: "member_dinner", label: "Member Dinner", tone: "gold" },
  { value: "roundtable", label: "Roundtable", tone: "purple" },
  { value: "panel", label: "Panel", tone: "purple" },
  { value: "site_visit", label: "Site Visit", tone: "teal" },
  { value: "conference", label: "Conference", tone: "amber" },
  { value: "social", label: "Social", tone: "slate" },
  { value: "other", label: "Other", tone: "slate" },
];

/// Where the event is in its lifecycle, in flow order. Terminal = completed /
/// cancelled (an event that's done or called off isn't "upcoming").
export const EVENT_STAGES: readonly EventDef[] = [
  { value: "planning", label: "Planning", tone: "slate" },
  { value: "invitations_sent", label: "Invitations Sent", tone: "purple" },
  { value: "confirmed", label: "Confirmed", tone: "gold" },
  { value: "completed", label: "Completed", tone: "teal" },
  { value: "cancelled", label: "Cancelled", tone: "red" },
];

/// Stages excluded from the "upcoming" list — the event is over or called off.
export const TERMINAL_EVENT_STAGES: readonly string[] = ["completed", "cancelled"];

/// Per-guest RSVP states (demo Invited / Confirmed / Declined / Attended / NoShow).
/// `attending` marks the states that count as coming (drives capacity + the guest
/// brief, which only briefs people who'll actually be in the room).
export type RsvpDef = EventDef & { attending: boolean };

export const RSVP_STATES: readonly RsvpDef[] = [
  { value: "invited", label: "Invited", tone: "slate", attending: false },
  { value: "confirmed", label: "Confirmed", tone: "teal", attending: true },
  { value: "declined", label: "Declined", tone: "red", attending: false },
  { value: "attended", label: "Attended", tone: "gold", attending: true },
  { value: "no_show", label: "No Show", tone: "red", attending: false },
];

const TYPE_BY_VALUE = new Map(EVENT_TYPES.map((t) => [t.value, t]));
const STAGE_BY_VALUE = new Map(EVENT_STAGES.map((s) => [s.value, s]));
const RSVP_BY_VALUE = new Map(RSVP_STATES.map((r) => [r.value, r]));

/// Resolve an event type to its definition; unknown values fall back to a neutral
/// slate badge carrying the raw value as its label.
export function getEventType(value: string): EventDef {
  return TYPE_BY_VALUE.get(value) ?? { value, label: value, tone: "slate" };
}

/// Resolve an event stage to its definition (same unknown-value fallback).
export function getEventStage(value: string): EventDef {
  return STAGE_BY_VALUE.get(value) ?? { value, label: value, tone: "slate" };
}

/// Resolve an RSVP state to its definition (unknown → non-attending slate).
export function getRsvpState(value: string): RsvpDef {
  return (
    RSVP_BY_VALUE.get(value) ?? {
      value,
      label: value,
      tone: "slate",
      attending: false,
    }
  );
}

/// Does this RSVP state count as coming to the event? Unknown states do not.
export function isAttending(value: string): boolean {
  return getRsvpState(value).attending;
}
