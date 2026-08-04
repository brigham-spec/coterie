import "server-only";

import { matchAttendee, CONFIRM_THRESHOLD } from "@/lib/attendee-match";
import type { FirefliesTranscript } from "@/lib/fireflies";
import { httpUrlOrNull } from "@/lib/form-fields";
import {
  normalizeEmail,
  extractDomain,
  isGenericDomain,
  inferOrgName,
  inferPersonName,
} from "@/lib/new-connections";
import { withOrg } from "@/lib/tenant";

// Shared Fireflies reconcile (build item 6, spec §3.16). Turns fetched
// transcripts into Meeting rows + matched attendees for ONE org. Extracted from
// the Inngest sync so the company-profile "paste a Fireflies ID" import runs the
// SAME idempotent path: meetings upsert on fireflies_id, attendee rows upsert on
// (meeting, contact) and NEVER overwrite a human's confirmation on re-sync, and
// an unmatched attendee carrying an org email is captured in unmatched_attendees
// for triage (personal mailboxes are skipped). Every write is withOrg-scoped, so
// reconcile can never touch another tenant.
//
// It deliberately does NOT stamp the org-wide last-synced clock (that's a
// property of a full sync run, which the caller owns) and does NOT create action
// items — Fireflies delivers them unattributed, so ownership is a later human/AI
// step, not a guess made here.

export type ReconcileResult = {
  meetings: number;
  attendees: number;
  newConnections: number;
};

export async function reconcileTranscripts(
  orgId: string,
  transcripts: FirefliesTranscript[],
): Promise<ReconcileResult> {
  // Load the org's contacts + companies once for matching (withOrg-scoped, so
  // the candidate set is this tenant's only).
  const { contacts, companies } = await withOrg(orgId, async (tx) => ({
    contacts: await tx.contact.findMany({
      select: { id: true, name: true, email: true, companyId: true },
    }),
    companies: await tx.company.findMany({
      select: { id: true, emailDomain: true },
    }),
  }));

  let meetings = 0;
  let attendees = 0;
  let newConnections = 0;

  for (const transcript of transcripts) {
    const heldAt =
      transcript.date != null ? new Date(transcript.date) : new Date();
    const title = (transcript.title ?? "").trim() || "Untitled meeting";
    const summary = transcript.summary?.overview ?? null;
    // Rendered as a clickable href on the meetings page — only http(s) links
    // survive so a non-http scheme can't become a stored-XSS vector.
    const transcriptUrl = httpUrlOrNull(transcript.transcript_url);

    const meeting = await withOrg(orgId, (tx) =>
      tx.meeting.upsert({
        where: { firefliesId: transcript.id },
        create: {
          orgId,
          firefliesId: transcript.id,
          title,
          heldAt,
          summary,
          transcriptUrl,
        },
        update: { title, heldAt, summary, transcriptUrl },
      }),
    );
    meetings++;

    for (const attendee of transcript.meeting_attendees ?? []) {
      const match = matchAttendee(
        {
          email: attendee.email,
          displayName: attendee.displayName,
          name: attendee.name,
        },
        contacts,
        companies,
      );
      if (match == null) {
        // Unmatched attendee: capture it for triage instead of dropping it.
        // Personal mailboxes identify no organisation, so skip those.
        const email = normalizeEmail(attendee.email);
        const domain = extractDomain(email);
        if (email === "" || domain === "" || isGenericDomain(domain)) continue;

        const inferredName =
          (attendee.displayName ?? attendee.name ?? "").trim() ||
          inferPersonName(email);

        const created = await withOrg(orgId, async (tx) => {
          const existing = await tx.unmatchedAttendee.findUnique({
            where: { orgId_email: { orgId, email } },
            select: { id: true, meetingIds: true },
          });
          if (existing == null) {
            await tx.unmatchedAttendee.create({
              data: {
                orgId,
                email,
                domain,
                inferredName,
                inferredOrg: inferOrgName(domain),
                meetingIds: [meeting.id],
                seenCount: 1,
                lastMeetingTitle: title,
              },
            });
            return true;
          }
          // Known stranger: only a NEW meeting bumps the count (a re-sync of
          // the same meeting is a no-op — meeting.id is stable across syncs).
          if (!existing.meetingIds.includes(meeting.id)) {
            const meetingIds = [...existing.meetingIds, meeting.id].slice(-20);
            await tx.unmatchedAttendee.update({
              where: { id: existing.id },
              data: {
                meetingIds,
                seenCount: meetingIds.length,
                lastMeetingTitle: title,
                lastSeenAt: new Date(),
              },
            });
          }
          return false;
        });
        if (created) newConnections++;
        continue;
      }

      // Matched: self-heal any stale unmatched row for this email (e.g. the
      // contact was added out-of-band since the last sync captured them).
      const matchedEmail = normalizeEmail(attendee.email);
      if (matchedEmail !== "")
        await withOrg(orgId, (tx) =>
          tx.unmatchedAttendee.deleteMany({ where: { email: matchedEmail } }),
        );

      await withOrg(orgId, (tx) =>
        tx.meetingAttendee.upsert({
          where: {
            meetingId_contactId: {
              meetingId: meeting.id,
              contactId: match.contactId,
            },
          },
          create: {
            orgId,
            meetingId: meeting.id,
            contactId: match.contactId,
            matchMethod: match.matchMethod,
            confidence: match.confidence,
            confirmed: match.confidence >= CONFIRM_THRESHOLD,
          },
          // Never clobber a human's confirmation (or an existing match) on
          // re-sync — the row is left exactly as the last human/sync left it.
          update: {},
        }),
      );
      attendees++;
    }
  }

  return { meetings, attendees, newConnections };
}
