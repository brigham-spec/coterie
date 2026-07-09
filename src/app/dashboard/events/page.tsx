import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  EVENT_STAGES,
  EVENT_TYPES,
  TERMINAL_EVENT_STAGES,
  getEventType,
  isAttending,
} from "@/lib/event-stages";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { createEvent } from "./actions";

// Events — the gatherings surface (slice 11.7). Stage and type are the canonical
// vocabulary (@/lib/event-stages). One withOrg pass loads every event with its
// invitees (RLS scopes it to this tenant); upcoming events (non-terminal stage)
// lead, past/cancelled ones follow.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function loadEvents(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx.event.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { invitees: { select: { rsvp: true } } },
    }),
  );
}

type EventRow = Awaited<ReturnType<typeof loadEvents>>[number];

export default async function EventsPage() {
  const ctx = await requireOrgContext();
  const events = await loadEvents(ctx.orgId);

  const upcoming = events.filter(
    (e) => !TERMINAL_EVENT_STAGES.includes(e.stage),
  );
  const past = events.filter((e) => TERMINAL_EVENT_STAGES.includes(e.stage));
  const totalGuests = events.reduce(
    (t, e) => t + e.invitees.filter((i) => isAttending(i.rsvp)).length,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Events"
          subtitle={`${events.length} in ${ctx.orgName}'s calendar`}
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Metric label="Upcoming" value={String(upcoming.length)} />
        <Metric label="Total events" value={String(events.length)} />
        <Metric label="Guests confirmed" value={String(totalGuests)} />
      </div>

      <Card>
        <CardHeader title="Add event" />
        <details className="group">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs text-ink-3 hover:text-ink">
            <span className="group-open:hidden">+ Add an event</span>
            <span className="hidden group-open:inline">Cancel</span>
          </summary>
          <form
            action={createEvent}
            className="grid grid-cols-2 gap-4 border-t border-line p-4"
          >
            <Field
              name="name"
              label="Event name"
              placeholder="Fall member dinner"
              required
              className="col-span-2"
            />
            <SelectField name="type" label="Type" defaultValue="member_dinner">
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            <SelectField name="stage" label="Stage" defaultValue="planning">
              {EVENT_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <Field name="date" label="Date" type="date" />
            <Field name="venue" label="Venue" placeholder="The Rhinecliff" />
            <Field
              name="capacity"
              label="Capacity"
              inputMode="numeric"
              placeholder="0"
            />
            <Field name="theme" label="Theme" placeholder="Capital & construction" />
            <Field
              name="description"
              label="Description"
              placeholder="Short summary"
              className="col-span-2"
            />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Add event
              </Button>
            </div>
          </form>
        </details>
      </Card>

      {events.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-xs text-ink-3">
            No events yet. Add one above.
          </p>
        </Card>
      ) : (
        <>
          <EventTable title="Upcoming" events={upcoming} />
          {past.length > 0 ? <EventTable title="Past" events={past} /> : null}
        </>
      )}
    </div>
  );
}

function EventTable({ title, events }: { title: string; events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="px-4 py-6 text-xs text-ink-3">Nothing here yet.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title={`${title} (${events.length})`} />
      <Table
        head={
          <>
            <Th>Event</Th>
            <Th>Type</Th>
            <Th>Stage</Th>
            <Th>Date</Th>
            <Th>Guests</Th>
          </>
        }
      >
        {events.map((e) => {
          const confirmed = e.invitees.filter((i) => isAttending(i.rsvp)).length;
          return (
            <Tr key={e.id}>
              <Td className="font-medium">
                <Link
                  href={`/dashboard/events/${e.id}`}
                  className="hover:text-gold hover:underline"
                >
                  {e.name}
                </Link>
              </Td>
              <Td>{getEventType(e.type).label}</Td>
              <Td>
                <StatusBadge status={e.stage} />
              </Td>
              <Td>{e.date == null ? "TBD" : dateFmt.format(e.date)}</Td>
              <Td>
                {confirmed}
                {e.capacity ? ` / ${e.capacity}` : ""}
              </Td>
            </Tr>
          );
        })}
      </Table>
    </Card>
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
