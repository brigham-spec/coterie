// Pure description of an Activity row for the org-wide audit log. Activity.type
// is an open string (the schema lists status_changed, note_added, intro_made,
// … as intended values); today only status_changed is written, but the
// describer degrades gracefully for any type so the audit view never shows a
// blank or cryptic row. Takes the raw JSON payload as `unknown` and narrows
// defensively, so the caller passes Prisma's JsonValue with no cast. No I/O —
// fully unit-testable.

import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";

export type ActivityDescription = {
  // Human label for the event type, e.g. "Status changed".
  action: string;
  // One-line detail, e.g. "prospect → member". Null when the payload carries
  // nothing worth showing.
  detail: string | null;
};

const humanize = (v: string): string =>
  v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function readString(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function describeActivity(
  type: string,
  payload: unknown,
): ActivityDescription {
  if (type === ACTIVITY_STATUS_CHANGED) {
    const to = readString(payload, "to");
    const from = readString(payload, "from");
    const toLabel = to ? humanize(to) : "unknown";
    return {
      action: "Status changed",
      detail: from ? `${humanize(from)} → ${toLabel}` : `New · ${toLabel}`,
    };
  }

  // Unknown/future type: show a humanized version of the raw type, no detail.
  return { action: humanize(type), detail: null };
}
