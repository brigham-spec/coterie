import { describe, it, expect } from "vitest";

import {
  EVENT_STAGES,
  RSVP_STATES,
  TERMINAL_EVENT_STAGES,
  getEventStage,
  getEventType,
  getRsvpState,
  isAttending,
  isEventType,
  isEventStage,
  isRsvpState,
} from "@/lib/event-stages";

// Unit test for the PURE event vocabulary (slice 11.7). Guards the resolvers the
// list, forms, and guest list all speak through — including the unknown-value
// fallback and the attending? predicate the guest brief filters on.

describe("event vocabulary", () => {
  it("resolves known types, stages, and rsvp states to their labels", () => {
    expect(getEventType("member_dinner").label).toBe("Member Dinner");
    expect(getEventStage("invitations_sent").label).toBe("Invitations Sent");
    expect(getRsvpState("no_show").label).toBe("No Show");
  });

  it("falls back to a neutral slate def for unknown values", () => {
    expect(getEventType("mystery")).toEqual({
      value: "mystery",
      label: "mystery",
      tone: "slate",
    });
    expect(getRsvpState("maybe")).toMatchObject({
      value: "maybe",
      tone: "slate",
      attending: false,
    });
  });

  it("marks only confirmed/attended as attending", () => {
    expect(isAttending("confirmed")).toBe(true);
    expect(isAttending("attended")).toBe(true);
    expect(isAttending("invited")).toBe(false);
    expect(isAttending("declined")).toBe(false);
    expect(isAttending("no_show")).toBe(false);
    expect(isAttending("unknown")).toBe(false);
  });

  it("treats completed and cancelled as terminal stages", () => {
    expect(TERMINAL_EVENT_STAGES).toContain("completed");
    expect(TERMINAL_EVENT_STAGES).toContain("cancelled");
    expect(TERMINAL_EVENT_STAGES).not.toContain("planning");
  });

  it("validates type/stage/rsvp membership for the write boundary", () => {
    expect(isEventType("member_dinner")).toBe(true);
    expect(isEventType("mystery")).toBe(false);
    expect(isEventStage("planning")).toBe(true);
    expect(isEventStage("mystery")).toBe(false);
    expect(isRsvpState("confirmed")).toBe(true);
    expect(isRsvpState("maybe")).toBe(false);
    expect(isRsvpState("")).toBe(false);
  });

  it("exposes a stable, non-empty vocabulary", () => {
    expect(EVENT_STAGES.length).toBeGreaterThan(0);
    expect(RSVP_STATES.map((r) => r.value)).toEqual([
      "invited",
      "confirmed",
      "declined",
      "attended",
      "no_show",
    ]);
  });
});
