import "server-only";

import * as Sentry from "@sentry/nextjs";

import {
  generateActionItems,
  ownerColumns,
  extractionNotes,
  MIN_EXTRACTION_LENGTH,
} from "@/lib/action-items";
import { loadStaffOwners, loadAttendeeOwners } from "@/lib/action-item-owners";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { withOrg } from "@/lib/tenant";

// Automatic action-item extraction on Fireflies sync (follow-up to the manual
// per-meeting extraction on the meetings surface). When a sync CREATES a meeting,
// this runs the same generateActionItems seam over its notes and persists the
// concrete follow-ups — so the operator arrives to a populated worklist instead
// of having to click "Extract" on every synced meeting.
//
// Two rules keep this faithful to the human-in-the-loop design it complements:
//   1. Owner-XOR, never guessed. The action_items CHECK requires exactly one
//      owner. We persist ONLY items whose owner the model resolved to a real
//      staff member or attendee (loaded RLS-scoped, so the id is trustworthy);
//      items it left unattributed are DROPPED, not assigned a guess. Those remain
//      available through the manual "Extract" button, where a human picks an owner.
//   2. Once per meeting. The caller passes only the ids of meetings this sync run
//      created, so a periodic re-sync (which updates the same rows) never
//      re-extracts — no duplicate items, no redundant model calls.
//
// A meeting whose Fireflies notes haven't populated yet (or are too short) is
// skipped; the manual button covers it once notes arrive on a later view.
//
// When the org's per-minute AI cap is hit mid-batch, this returns the meetings it
// couldn't reach in `remaining` rather than dropping them. The Inngest job that
// calls it (extractActionItems) re-triggers itself after a cooldown with exactly
// those ids, so a sync that creates more meetings than the cap allows still drains
// them all instead of silently extracting only the first few.

export interface ExtractRunResult {
  created: number; // action items persisted across the meetings reached
  remaining: readonly string[]; // meeting ids not reached (hit the AI cap)
}

/// Auto-extract and persist owner-resolved action items for the given meetings.
/// Never throws: a failure on one meeting is logged, forwarded to Sentry, and
/// skipped so the rest still process. Hitting the org's AI rate cap stops the run
/// early and returns the unreached meetings in `remaining` for the caller to
/// retry after a cooldown. Returns the count persisted and any remaining ids.
export async function autoExtractActionItems(
  orgId: string,
  meetingIds: readonly string[],
): Promise<ExtractRunResult> {
  if (meetingIds.length === 0) return { created: 0, remaining: [] };

  // Staff candidates are org-wide, so load them once for the whole batch.
  const staff = await loadStaffOwners(orgId);
  let created = 0;

  for (let i = 0; i < meetingIds.length; i++) {
    const meetingId = meetingIds[i];
    try {
      const meeting = await withOrg(orgId, (tx) =>
        tx.meeting.findUnique({
          where: { id: meetingId },
          select: { summary: true, actionItemsText: true },
        }),
      );
      // Prefer Fireflies' structured action_items text over the thematic overview.
      const notes = meeting ? extractionNotes(meeting) : "";
      if (notes.length < MIN_EXTRACTION_LENGTH) continue;

      const contacts = await loadAttendeeOwners(orgId, meetingId);

      await enforceAiRateLimit(orgId);
      const candidates = await generateActionItems(notes, staff, contacts);

      // Persist only the items the model attributed to a real staff/contact
      // owner. generateActionItems already resolved each owner against the
      // candidate pools above, so a "staff"/"contact" ownerId is a trusted,
      // RLS-scoped id — no re-validation needed (unlike saveActionItems, which
      // trusts client input).
      const toCreate = candidates
        .filter(
          (c) =>
            c.ownerId != null &&
            (c.ownerKind === "staff" || c.ownerKind === "contact"),
        )
        .map((c) => ({
          orgId,
          meetingId,
          text: c.text,
          ...ownerColumns(
            c.ownerKind as "staff" | "contact",
            c.ownerId as string,
          ),
        }));
      if (toCreate.length === 0) continue;

      await withOrg(orgId, (tx) => tx.actionItem.createMany({ data: toCreate }));
      created += toCreate.length;
    } catch (err) {
      // Over the org's AI cap: stop here and hand back the meetings we haven't
      // reached yet (this one included) so the caller can resume after a cooldown
      // instead of dropping them.
      if (err instanceof AiRateLimitError)
        return { created, remaining: meetingIds.slice(i) };
      // Any other failure on this meeting (model/parse/DB): skip it, keep going.
      // Forward it to Sentry (which emails) so a systematic extraction problem
      // reaches the operator rather than dying in a log no one reads. The manual
      // "Extract" button remains available for this meeting.
      console.error(`auto-extract failed for meeting ${meetingId}:`, err);
      Sentry.captureException(err, {
        tags: { source: "auto-action-items" },
        extra: { orgId, meetingId },
      });
      continue;
    }
  }

  return { created, remaining: [] };
}
