import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { hasCredential } from "@/lib/integrations";
import { Button, Card, CardHeader, Field, PageTitle } from "@/components/ui";

import {
  connectFireflies,
  disconnectFireflies,
  syncFirefliesNow,
  confirmAttendee,
  rejectAttendee,
} from "./actions";

// Meetings — synced from Fireflies (build item 6). Connect a per-org API key,
// pull transcripts into Meeting rows on demand, and confirm the attendee matches
// the sync proposed. Only exact-email matches auto-confirm; weaker signals wait
// here for a human. Everything is read through withOrg — no cross-tenant leak.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const methodLabel: Record<string, string> = {
  email: "email",
  domain: "domain",
  display_name: "name",
  surname: "surname",
};

export default async function MeetingsPage() {
  const ctx = await requireOrgContext();

  const [connected, meetings] = await Promise.all([
    hasCredential(ctx.orgId, "fireflies"),
    withOrg(ctx.orgId, (tx) =>
      tx.meeting.findMany({
        orderBy: { heldAt: "desc" },
        include: {
          attendees: {
            orderBy: { confidence: "desc" },
            include: {
              contact: {
                select: { name: true, company: { select: { name: true } } },
              },
            },
          },
        },
      }),
    ),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Meetings"
          subtitle={`${meetings.length} synced from Fireflies for ${ctx.orgName}`}
        />
      </div>

      <Card>
        <CardHeader
          title="Fireflies"
          action={
            connected ? (
              <div className="flex items-center gap-2">
                <form action={syncFirefliesNow}>
                  <Button type="submit" variant="gold">
                    Sync now
                  </Button>
                </form>
                <form action={disconnectFireflies}>
                  <Button type="submit">Disconnect</Button>
                </form>
              </div>
            ) : null
          }
        />
        {connected ? (
          <p className="px-4 py-4 text-xs text-ink-3">
            Connected. Syncing pulls your recent transcripts and matches
            attendees to contacts. Matches below full confidence appear on each
            meeting for you to confirm.
          </p>
        ) : (
          <form action={connectFireflies} className="flex items-end gap-3 p-4">
            <Field
              name="apiKey"
              label="Fireflies API key"
              type="password"
              placeholder="Paste your Fireflies API key"
              className="flex-1"
              required
            />
            <Button type="submit" variant="primary">
              Connect
            </Button>
          </form>
        )}
      </Card>

      {meetings.length === 0 ? (
        <Card>
          <CardHeader title="Synced meetings" />
          <p className="px-4 py-6 text-xs text-ink-3">
            {connected
              ? "No meetings yet. Use “Sync now” to pull transcripts from Fireflies."
              : "Connect Fireflies above to sync your meetings."}
          </p>
        </Card>
      ) : (
        meetings.map((meeting) => (
          <Card key={meeting.id}>
            <CardHeader
              title={meeting.title}
              action={
                <span className="text-[11px] text-ink-3">
                  {dateFmt.format(meeting.heldAt)}
                  {meeting.transcriptUrl != null ? (
                    <>
                      {" · "}
                      <a
                        href={meeting.transcriptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gold underline"
                      >
                        transcript
                      </a>
                    </>
                  ) : null}
                </span>
              }
            />
            <div className="px-4 py-4">
              {meeting.summary != null && meeting.summary !== "" ? (
                <p className="mb-4 text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
                  {meeting.summary}
                </p>
              ) : null}

              {meeting.attendees.length === 0 ? (
                <p className="text-xs text-ink-3">
                  No attendees matched to contacts.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {meeting.attendees.map((a) => (
                    <li
                      key={a.contactId}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-ink">
                        <span className="font-medium">{a.contact.name}</span>
                        <span className="text-ink-3">
                          {" · "}
                          {a.contact.company.name}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-2">
                          {methodLabel[a.matchMethod] ?? a.matchMethod} ·{" "}
                          {Math.round(a.confidence * 100)}%
                        </span>
                        {a.confirmed ? (
                          <span className="rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-medium text-teal-ink">
                            confirmed
                          </span>
                        ) : (
                          <>
                            <form action={confirmAttendee}>
                              <input
                                type="hidden"
                                name="meetingId"
                                value={meeting.id}
                              />
                              <input
                                type="hidden"
                                name="contactId"
                                value={a.contactId}
                              />
                              <Button type="submit" variant="gold">
                                Confirm
                              </Button>
                            </form>
                            <form action={rejectAttendee}>
                              <input
                                type="hidden"
                                name="meetingId"
                                value={meeting.id}
                              />
                              <input
                                type="hidden"
                                name="contactId"
                                value={a.contactId}
                              />
                              <Button type="submit">Reject</Button>
                            </form>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
