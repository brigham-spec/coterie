import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { hasCredential } from "@/lib/integrations";
import {
  matchesMeetingFilters,
  meetingMemberFacets,
  meetingPreview,
  meetingStats,
  toMeetingView,
  type MeetingFilters,
} from "@/lib/meetings-view";
import { Button, Card, CardHeader, Field, PageTitle } from "@/components/ui";

import {
  connectFireflies,
  disconnectFireflies,
  syncFirefliesNow,
  confirmAttendee,
  rejectAttendee,
} from "./actions";
import {
  MeetingActionItems,
  type OwnerOption,
} from "./_action-items";
import { MeetingFilters as FilterBar } from "./_filters";
import { LogMeeting } from "./_log-meeting";
import { MeetingCard } from "./_meeting-card";

// Meetings — synced from Fireflies (build item 6). Connect a per-org API key,
// pull transcripts into Meeting rows on demand, and confirm the attendee matches
// the sync proposed. Only exact-email matches auto-confirm; weaker signals wait
// here for a human. Everything is read through withOrg — no cross-tenant leak.
// The list is a filterable workspace (parity: Meet 8/9/10): keyword/source/member
// filters, a stats bar, deduped member tags, and collapse-to-preview cards. The
// derivation is pure and unit-tested (@/lib/meetings-view).

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

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const rawSource = one(sp.source);
  const filters: MeetingFilters = {
    q: one(sp.q),
    source: rawSource === "fireflies" || rawSource === "manual" ? rawSource : "",
    member: one(sp.member),
  };

  const [connected, data, staffRows] = await Promise.all([
    hasCredential(ctx.orgId, "fireflies"),
    withOrg(ctx.orgId, async (tx) => {
      const meetings = await tx.meeting.findMany({
        orderBy: { heldAt: "desc" },
        include: {
          attendees: {
            orderBy: { confidence: "desc" },
            include: {
              contact: {
                select: {
                  name: true,
                  company: { select: { id: true, name: true } },
                },
              },
            },
          },
          actionItems: {
            orderBy: { createdAt: "asc" },
            include: {
              ownerUser: { select: { name: true } },
              ownerContact: { select: { name: true } },
            },
          },
        },
      });
      // Attendee options for the global "+ Log Meeting" picker — any contact in
      // the network, not just one company's (same tx, so one pooled connection).
      const contacts = await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      });
      return { meetings, contacts };
    }),
    // Org staff = org members (platform table, no RLS — read off bare prisma).
    prisma.orgMembership.findMany({
      where: { orgId: ctx.orgId },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const { meetings, contacts } = data;
  const contactOptions = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company.name,
  }));

  const staffOptions: OwnerOption[] = staffRows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
  }));

  // Derive each meeting's view once (source + deduped member tags), then use it
  // for the stats bar, the member facets, and the filter — keeping the full
  // prisma row alongside for the attendee + action-item detail.
  const paired = meetings.map((meeting) => ({
    meeting,
    view: toMeetingView(meeting),
  }));
  const views = paired.map((p) => p.view);
  const stats = meetingStats(views);
  const memberFacets = meetingMemberFacets(views);
  const visible = paired.filter((p) => matchesMeetingFilters(p.view, filters));

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

      <LogMeeting contacts={contactOptions} />

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
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Meetings" value={String(stats.total)} />
            <Metric label="From Fireflies" value={String(stats.fireflies)} />
            <Metric label="Manual" value={String(stats.manual)} />
            <Metric label="Members" value={String(stats.members)} />
          </div>

          <FilterBar members={memberFacets} />

          {visible.length === 0 ? (
            <Card>
              <p className="px-4 py-6 text-xs text-ink-3">
                No meetings match these filters.
              </p>
            </Card>
          ) : (
            visible.map(({ meeting, view }) => {
              // Cross-attribution pool (Meet 12): every network contact who
              // wasn't at this meeting, offered as an owner so an item mentioning
              // an absent member can be attributed to them.
              const attendeeIds = new Set(
                meeting.attendees.map((a) => a.contactId),
              );
              const networkOptions = contactOptions.filter(
                (c) => !attendeeIds.has(c.id),
              );
              return (
                // id anchors this card so deep links (e.g. the Commitments "Scan"
                // button) can jump straight to it; scroll-mt keeps it clear of
                // the top. Scan targets (notes but no commitments) land expanded.
                <div key={meeting.id} id={meeting.id} className="scroll-mt-4">
                  <MeetingCard
                    title={meeting.title}
                    dateLabel={dateFmt.format(meeting.heldAt)}
                    durationMinutes={meeting.durationMinutes}
                    location={meeting.location}
                    transcriptUrl={meeting.transcriptUrl}
                    source={view.source}
                    members={view.members}
                    summary={meeting.summary}
                    preview={meetingPreview(meeting.summary)}
                    defaultOpen={
                      meeting.summary != null &&
                      meeting.summary !== "" &&
                      meeting.actionItems.length === 0
                    }
                  >
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
                              <span className="font-medium">
                                {a.contact.name}
                              </span>
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

                    <div className="mt-4">
                      <MeetingActionItems
                        meetingId={meeting.id}
                        staffOptions={staffOptions}
                        attendeeOptions={meeting.attendees.map((a) => ({
                          id: a.contactId,
                          name: a.contact.name,
                        }))}
                        networkOptions={networkOptions}
                        items={meeting.actionItems.map((it) => ({
                          id: it.id,
                          text: it.text,
                          status: it.status,
                          owner:
                            it.ownerUser?.name ?? it.ownerContact?.name ?? "—",
                        }))}
                      />
                    </div>
                  </MeetingCard>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-card">
      <div className="font-serif text-[18px] text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
    </div>
  );
}
