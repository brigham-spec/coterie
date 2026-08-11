import { describe, expect, it } from "vitest";

import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import { describeActivity } from "@/lib/audit-log";

// The audit-log row describer. Status changes get a "from → to" line; the
// founding row (from: null) reads as "New · <status>"; any unknown type falls
// back to a humanized label so the view never shows a blank cell.

describe("describeActivity", () => {
  it("describes a status transition", () => {
    expect(
      describeActivity(ACTIVITY_STATUS_CHANGED, {
        from: "prospect",
        to: "member",
      }),
    ).toEqual({ action: "Status changed", detail: "Prospect → Member" });
  });

  it("describes the founding status (from is null)", () => {
    expect(
      describeActivity(ACTIVITY_STATUS_CHANGED, { from: null, to: "prospect" }),
    ).toEqual({ action: "Status changed", detail: "New · Prospect" });
  });

  it("humanizes multi-word statuses", () => {
    expect(
      describeActivity(ACTIVITY_STATUS_CHANGED, {
        from: "prospect",
        to: "strategic_partner",
      }).detail,
    ).toBe("Prospect → Strategic partner");
  });

  it("falls back to a humanized label for an unknown type", () => {
    expect(describeActivity("note_added", {})).toEqual({
      action: "Note added",
      detail: null,
    });
  });
});
