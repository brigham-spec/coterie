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
import { prisma } from "@/lib/prisma";
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
  // Ids of meetings created by THIS run (not ones an update touched). The sync
  // job uses these to auto-extract action items exactly once per meeting — a
  // re-sync updates the same row, so it never re-appears here and can't trigger
  // a duplicate extraction. Empty for the import path, which ignores it.
  createdMeetingIds: string[];
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

  // The org's own staff (email -> userId). An attendee whose email matches a
  // staffer is recorded as staff attendance (tier-3 "New Connections" scoping),
  // NOT matched as a contact or captured as a new connection. Read via bare
  // prisma: org_memberships/users carry no RLS (platform-level), so this is a
  // separate connection from the withOrg tx — never run it concurrently on a
  // pinned tx client.
  const staffRows = await prisma.orgMembership.findMany({
    where: { orgId },
    select: { user: { select: { id: true, email: true } } },
  });
  const staffByEmail = new Map(
    staffRows.map((r) => [normalizeEmail(r.user.email), r.user.id]),
  );

  // Resolve a matched contact back to its company so a synced meeting freshens
  // that company's last-contact clock (powers the dashboard "Needs a Call").
  const companyByContactId = new Map(
    contacts.map((c) => [c.id, c.companyId]),
  );

  let meetings = 0;
  let attendees = 0;
  let newConnections = 0;
  const createdMeetingIds: string[] = [];

  for (const transcript of transcripts) {
    const heldAt =
      transcript.date != null ? new Date(transcript.date) : new Date();
    const title = (transcript.title ?? "").trim() || "Untitled meeting";
    const summary = transcript.summary?.overview ?? null;
    // Fireflies' structured action-items text (real commitments, often with
    // owners) — stored separately from the narrative overview so extraction has
    // something to lift from. null when absent.
    const actionItemsText = transcript.summary?.action_items?.trim() || null;
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
          actionItemsText,
          transcriptUrl,
        },
        update: { title, heldAt, summary, actionItemsText, transcriptUrl },
        select: { id: true, createdAt: true, updatedAt: true },
      }),
    );
    // Detect create-vs-update: the sync job must auto-extract action items only
    // for meetings this run actually created (a re-sync updating the same row
    // must not re-extract). A freshly-created row has createdAt === updatedAt (a
    // later update always bumps @updatedAt), so equal timestamps mark a create.
    // This also races safely: of two concurrent syncs, only the one that won the
    // create sees equal timestamps, so a meeting is extracted at most once.
    if (meeting.createdAt.getTime() === meeting.updatedAt.getTime())
      createdMeetingIds.push(meeting.id);
    meetings++;

    // Companies whose contacts attended this meeting — their last-contact clock
    // is advanced to heldAt after the attendee loop (forward-only).
    const touchedCompanyIds = new Set<string>();

    for (const attendee of transcript.meeting_attendees ?? []) {
      // Our own staff: record who was on the call (scopes the dashboard's New
      // Connections to "my meetings") and skip — a staffer is never a contact
      // match or a "new connection" to themselves.
      const staffUserId = staffByEmail.get(normalizeEmail(attendee.email));
      if (staffUserId != null) {
        await withOrg(orgId, (tx) =>
          tx.meetingStaffAttendee.upsert({
            where: {
              meetingId_userId: { meetingId: meeting.id, userId: staffUserId },
            },
            create: { orgId, meetingId: meeting.id, userId: staffUserId },
            update: {},
          }),
        );
        continue;
      }

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
      const touchedCompanyId = companyByContactId.get(match.contactId);
      if (touchedCompanyId != null) touchedCompanyIds.add(touchedCompanyId);
      attendees++;
    }

    // Advance the last-contact clock for every company seen on this meeting.
    // Forward-only: an older backfilled transcript must not roll a company's
    // clock backwards past a more recent touch.
    if (touchedCompanyIds.size > 0)
      await withOrg(orgId, (tx) =>
        tx.company.updateMany({
          where: {
            id: { in: [...touchedCompanyIds] },
            OR: [{ lastContactAt: null }, { lastContactAt: { lt: heldAt } }],
          },
          data: { lastContactAt: heldAt },
        }),
      );
  }

  return { meetings, attendees, newConnections, createdMeetingIds };
}
