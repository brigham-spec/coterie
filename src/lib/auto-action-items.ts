import "server-only";

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

/// Auto-extract and persist owner-resolved action items for the given meetings.
/// Best-effort per meeting: an extraction failure on one meeting is swallowed so
/// the rest still process, and hitting the org's AI rate cap stops the batch
/// (the remaining meetings stay available for manual extraction). Returns the
/// number of action items persisted across all meetings.
export async function autoExtractActionItems(
  orgId: string,
  meetingIds: readonly string[],
): Promise<number> {
  if (meetingIds.length === 0) return 0;

  // Staff candidates are org-wide, so load them once for the whole batch.
  const staff = await loadStaffOwners(orgId);
  let created = 0;

  for (const meetingId of meetingIds) {
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

    let candidates;
    try {
      await enforceAiRateLimit(orgId);
      candidates = await generateActionItems(notes, staff, contacts);
    } catch (err) {
      // Over the org's AI cap: stop here rather than burning retries — the
      // remaining meetings are left for manual extraction.
      if (err instanceof AiRateLimitError) break;
      // Any other model/parse failure: skip this meeting, keep going. Log it so
      // a systematic extraction problem is visible rather than silently dropped.
      console.error(
        `auto-extract failed for meeting ${meetingId}:`,
        err,
      );
      continue;
    }

    // Persist only the items the model attributed to a real staff/contact owner.
    // generateActionItems already resolved each owner against the candidate pools
    // above, so a "staff"/"contact" ownerId is a trusted, RLS-scoped id — no
    // re-validation needed (unlike saveActionItems, which trusts client input).
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
        ...ownerColumns(c.ownerKind as "staff" | "contact", c.ownerId as string),
      }));
    if (toCreate.length === 0) continue;

    await withOrg(orgId, (tx) => tx.actionItem.createMany({ data: toCreate }));
    created += toCreate.length;
  }

  return created;
}
