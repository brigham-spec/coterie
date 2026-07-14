import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  EVENT_STAGES,
  RSVP_STATES,
  getEventType,
  getRsvpState,
} from "@/lib/event-stages";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  StatusBadge,
  TagBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import {
  addInvitee,
  removeInvitee,
  updateEventStage,
  updateInviteeRsvp,
} from "../actions";
import { GuestBrief } from "./_guest-brief";
import { Outreach } from "./_outreach";

// Event detail — the seat of the guest list (slice 11.7). event_invitees carries a
// composite FK to events(id, org_id) so a guest can never straddle orgs; the optional
// contact FK is re-checked inside withOrg on write. The reads below are withOrg-scoped
// so nothing foreign shows.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const data = await withOrg(ctx.orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id },
      include: {
        invitees: {
          include: {
            contact: {
              select: { name: true, title: true, company: { select: { name: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!event) return null;
    const contacts = await tx.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: { select: { name: true } } },
    });
    return { event, contacts };
  });

  if (data == null) notFound();
  const { event, contacts } = data;

  const invitedContactIds = new Set(
    event.invitees.map((i) => i.contactId).filter((v): v is string => v != null),
  );
  const invitable = contacts.filter((c) => !invitedContactIds.has(c.id));

  // CRM guests already on the list — the pool the outreach draft can write to
  // (external guests have no profile to ground a personal invitation in).
  const outreachGuests = event.invitees
    .filter((i) => i.contactId != null && i.contact != null)
    .map((i) => ({ id: i.id, name: i.contact!.name }));

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Type", value: getEventType(event.type).label },
    { label: "Date", value: event.date == null ? null : dateFmt.format(event.date) },
    { label: "Venue", value: event.venue },
    { label: "Theme", value: event.theme },
    {
      label: "Capacity",
      value: event.capacity == null ? null : String(event.capacity),
    },
    {
      label: "Cost",
      value: event.cost == null ? null : `$${Number(event.cost).toLocaleString()}`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/events"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Events
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle
            title={event.name}
            subtitle={event.description || undefined}
          />
          <StatusBadge status={event.stage} />
        </div>
      </div>

      <Card>
        <CardHeader title="Details" />
        <dl className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                {f.label}
              </dt>
              <dd className="text-ink">{f.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <form
          action={updateEventStage}
          className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3"
        >
          <input type="hidden" name="eventId" value={event.id} />
          <SelectField
            name="stage"
            label="Advance stage"
            defaultValue={event.stage}
            className="min-w-[200px]"
          >
            {EVENT_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <Button type="submit">Update stage</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title={`Guest list (${event.invitees.length})`} />
        {event.invitees.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">No guests invited yet.</p>
        ) : (
          <Table
            head={
              <>
                <Th>Guest</Th>
                <Th>Organization</Th>
                <Th>RSVP</Th>
                <Th>Update</Th>
                <Th> </Th>
              </>
            }
          >
            {event.invitees.map((i) => {
              const name = i.contact?.name ?? i.externalName ?? "Guest";
              const org = i.contact?.company?.name ?? i.externalOrg ?? "—";
              const rsvp = getRsvpState(i.rsvp);
              return (
                <Tr key={i.id}>
                  <Td className="font-medium">
                    {name}
                    {i.contact?.title ? (
                      <span className="ml-1 text-[10px] text-ink-3">
                        {i.contact.title}
                      </span>
                    ) : null}
                    {i.contactId == null ? (
                      <span className="ml-1.5 text-[9px] text-ink-3 italic">
                        external
                      </span>
                    ) : null}
                  </Td>
                  <Td>{org}</Td>
                  <Td>
                    <TagBadge label={rsvp.label} tone={rsvp.tone} />
                  </Td>
                  <Td>
                    <form action={updateInviteeRsvp} className="flex items-center gap-2">
                      <input type="hidden" name="inviteeId" value={i.id} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <select
                        name="rsvp"
                        defaultValue={i.rsvp}
                        className="rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
                      >
                        {RSVP_STATES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Button type="submit">Save</Button>
                    </form>
                  </Td>
                  <Td>
                    <form action={removeInvitee}>
                      <input type="hidden" name="inviteeId" value={i.id} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <button
                        type="submit"
                        className="text-[11px] text-ink-3 hover:text-red-ink"
                      >
                        Remove
                      </button>
                    </form>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      <GuestBrief eventId={event.id} />

      <Outreach eventId={event.id} guests={outreachGuests} />

      <Card>
        <CardHeader title="Add a guest" />
        <form action={addInvitee} className="grid grid-cols-2 gap-4 p-4">
          <input type="hidden" name="eventId" value={event.id} />
          <SelectField
            name="contactId"
            label="From the network"
            defaultValue=""
            className="col-span-2"
          >
            <option value="">Select a contact…</option>
            {invitable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company?.name ? ` — ${c.company.name}` : ""}
              </option>
            ))}
          </SelectField>
          <div className="col-span-2 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            or an external guest
          </div>
          <Field name="externalName" label="Name" placeholder="Jamie Rivera" />
          <Field name="externalOrg" label="Organization" placeholder="Rivera Capital" />
          <div className="col-span-2 flex justify-end">
            <Button type="submit" variant="primary">
              Add guest
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
