import { Inngest, NonRetriableError } from "inngest";

import { getCredential } from "@/lib/integrations";
import { listTranscripts } from "@/lib/fireflies";
import { matchAttendee, CONFIRM_THRESHOLD } from "@/lib/attendee-match";
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

    for (const transcript of transcripts) {
      const heldAt =
        transcript.date != null ? new Date(transcript.date) : new Date();
      const title = (transcript.title ?? "").trim() || "Untitled meeting";
      const summary = transcript.summary?.overview ?? null;
      const transcriptUrl = transcript.transcript_url ?? null;

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
        if (match == null) continue;

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

    return { meetings, attendees };
  },
);

// Registered with the serve route (src/app/api/inngest/route.ts).
export const functions = [ping, syncFireflies];
