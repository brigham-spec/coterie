import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";
import {
  EVENT_STAGES,
  EVENT_TYPES,
  TERMINAL_EVENT_STAGES,
  getEventType,
  isAttending,
} from "@/lib/event-stages";
import {
  AddDisclosure,
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
import { DeleteEventRow } from "./_delete-event-row";
import { EventIdeas } from "./_event-ideas";

// Events — the gatherings surface (slice 11.7). Stage and type are the canonical
// vocabulary (@/lib/event-stages). One withOrg pass loads every event with its
// invitees (RLS scopes it to this tenant); upcoming events (non-terminal stage)
// lead, past/cancelled ones follow.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function loadEventsData(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const events = await tx.event.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        invitees: { select: { rsvp: true } },
        conversions: { select: { arr: true } },
      },
    });
    const projects = await tx.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    // Members never on any guest list (via a network contact) — the "never invited"
    // roster the prototype nudges you to include (Coterie.html:7584).
    const members = await tx.company.findMany({
      where: { status: "member" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const invited = await tx.eventInvitee.findMany({
      where: { contactId: { not: null } },
      select: { contact: { select: { companyId: true } } },
    });
    return { events, projects, members, invited };
  });
}

type EventRow = Awaited<
  ReturnType<typeof loadEventsData>
>["events"][number];

export default async function EventsPage() {
  await requireModule("events");
  const ctx = await requireOrgContext();
  const { events, projects, members, invited } = await loadEventsData(ctx.orgId);

  const upcoming = events.filter(
    (e) => !TERMINAL_EVENT_STAGES.includes(e.stage),
  );
  const past = events.filter((e) => TERMINAL_EVENT_STAGES.includes(e.stage));
  const totalGuests = events.reduce(
    (t, e) => t + e.invitees.filter((i) => isAttending(i.rsvp)).length,
    0,
  );

  // New members + Net ROI across the whole calendar (prototype list stats,
  // Coterie.html:7578). ARR/cost are dollars.
  const newMembers = events.reduce((t, e) => t + e.conversions.length, 0);
  const totalArr = events.reduce(
    (t, e) => t + e.conversions.reduce((s, c) => s + (c.arr == null ? 0 : Number(c.arr)), 0),
    0,
  );
  const totalCost = events.reduce(
    (t, e) => t + (e.cost == null ? 0 : Number(e.cost)),
    0,
  );
  const netRoi = totalArr - totalCost;

  const invitedCompanyIds = new Set(
    invited.map((i) => i.contact?.companyId).filter((v): v is string => v != null),
  );
  const neverInvited = members.filter((m) => !invitedCompanyIds.has(m.id));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Events"
          subtitle={`${events.length} in ${ctx.orgName}'s calendar`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Upcoming" value={String(upcoming.length)} />
        <Metric label="Total events" value={String(events.length)} />
        <Metric label="Guests confirmed" value={String(totalGuests)} />
        <Metric label="New members" value={String(newMembers)} />
        <Metric
          label="Net ROI"
          value={`${netRoi < 0 ? "-" : ""}$${(Math.abs(netRoi) / 1000).toFixed(0)}k`}
        />
      </div>

      <Card>
        <CardHeader title="Add event" />
        <AddDisclosure label="+ Add an event">
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
            <SelectField name="projectId" label="Linked project" defaultValue="">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
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
        </AddDisclosure>
      </Card>

      <EventIdeas />

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

      {neverInvited.length > 0 ? (
        <Card>
          <CardHeader
            title={`Never invited to an event (${neverInvited.length})`}
          />
          <div className="flex flex-wrap gap-2 p-4">
            {neverInvited.slice(0, 20).map((m) => (
              <Link
                key={m.id}
                href={`/dashboard/companies/${m.id}`}
                className="rounded-full bg-amber-bg px-2.5 py-0.5 text-[10px] text-amber-ink hover:underline"
              >
                {m.name}
              </Link>
            ))}
            {neverInvited.length > 20 ? (
              <span className="px-1 py-0.5 text-[10px] text-ink-3">
                +{neverInvited.length - 20} more
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}
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
            <Th>Venue</Th>
            <Th>Guests</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
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
              <Td>{e.venue == null || e.venue === "" ? "—" : e.venue}</Td>
              <Td>
                {confirmed}
                {e.capacity ? ` / ${e.capacity}` : ""}
              </Td>
              <Td>
                <DeleteEventRow eventId={e.id} eventName={e.name} />
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
