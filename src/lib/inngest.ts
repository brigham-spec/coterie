import { Inngest, NonRetriableError } from "inngest";

import { getCredential } from "@/lib/integrations";
import { listTranscripts } from "@/lib/fireflies";
import { matchAttendee, CONFIRM_THRESHOLD } from "@/lib/attendee-match";
import { httpUrlOrNull } from "@/lib/form-fields";
import {
  normalizeEmail,
  extractDomain,
  isGenericDomain,
  inferOrgName,
  inferPersonName,
} from "@/lib/new-connections";
import { withOrg } from "@/lib/tenant";

// Inngest client + function registry (build item 6, spec §8). Inngest runs our
// background jobs — the Fireflies meeting sync is the first real one. Jobs are
// durable and retried, so a flaky external API doesn't drop a sync.
//
// Every job that touches tenant data MUST scope through withOrg (cardinal rule
// #1): the org_id travels in the event payload, never inferred from ambient
// state. Inngest has no request/auth context of its own, so the triggering code
// is responsible for stamping the correct org_id onto the event.

export const inngest = new Inngest({ id: "coterie" });

// A no-op job used to verify the Inngest wiring end-to-end (event received →
// function ran) before any real sync exists. Safe to keep — it touches nothing.
export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "coterie/ping" }] },
  async () => ({ ok: true, ranAt: new Date().toISOString() }),
);

// Pull recent Fireflies transcripts for one org and reconcile them into Meeting
// rows + matched attendees. Idempotent: meetings upsert on the unique
// fireflies_id, attendee rows upsert on (meeting, contact) and NEVER overwrite a
// human's confirmation on re-sync. All writes are withOrg-scoped to the org from
// the event payload — the job cannot touch another tenant.
//
// New Connections: an attendee that matches NO contact is no longer dropped — if
// it carries an org email (not a personal mailbox) it is recorded in
// unmatched_attendees so a human can promote it to a prospect or attach it to an
// existing company (the prototype's "New Connections Detected"). This too is
// idempotent: seenCount only bumps when a NEW meeting id is added, and a match
// self-heals any stale unmatched row for that email.
//
// Action items: deferred by design. action_items carries a XOR CHECK (exactly
// one of owner_user_id / owner_contact_id), but Fireflies delivers action items
// unattributed. Auto-creating them would force a guessed owner, violating the
// "never silently assume" rule — so ownership is assigned by a human/AI step
// later, not here.
export const syncFireflies = inngest.createFunction(
  { id: "fireflies-sync", triggers: [{ event: "coterie/fireflies.sync" }] },
  async ({ event }) => {
    // Inngest carries no auth context — the org_id is the only tenant signal, so
    // validate it explicitly. A malformed event is a bug, not a transient
    // failure, so don't retry it.
    const data = event.data as { orgId?: unknown };
    if (typeof data.orgId !== "string" || data.orgId === "")
      throw new NonRetriableError("fireflies.sync event missing orgId");
    const orgId = data.orgId;

    const credential = await getCredential(orgId, "fireflies");
    if (credential == null)
      return { meetings: 0, attendees: 0, reason: "no fireflies credential" };

    const transcripts = await listTranscripts(credential.accessToken);

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

    // Stamp the sync clock so the dashboard sync-status card can report
    // freshness. updateMany (not update) keeps this a no-op-safe write scoped by
    // RLS — a missing credential row simply updates nothing.
    await withOrg(orgId, (tx) =>
      tx.integrationCredential.updateMany({
        where: { provider: "fireflies" },
        data: { lastSyncedAt: new Date() },
      }),
    );

    return { meetings, attendees, newConnections };
  },
);

// Registered with the serve route (src/app/api/inngest/route.ts).
export const functions = [ping, syncFireflies];
