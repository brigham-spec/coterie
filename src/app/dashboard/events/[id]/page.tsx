import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import {
  RSVP_CONFIRMED,
  RSVP_STATES,
  getEventType,
  getRsvpState,
} from "@/lib/event-stages";
import { NETWORK_STATUSES } from "@/lib/company-statuses";
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
  addConversion,
  addInvitee,
  markAllAttended,
  removeConversion,
  removeInvitee,
  setEventSponsor,
  updateEventCost,
  updateInviteeRsvp,
} from "../actions";
import { DetailsCard, type EventDetails } from "./_details-card";
import { GuestBrief } from "./_guest-brief";
import { Outreach } from "./_outreach";
import { FindTargets } from "./_find-targets";
import { SuggestGuests } from "./_suggest-guests";
import { PromoteGuest } from "./_promote-guest";
import {
  Debrief,
  type EventIntro,
  type FollowUp,
} from "./_debrief";
import { DeleteEvent } from "./_delete-event";

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
  await requireModule("events");
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Org staff = org members (platform table, no RLS). Kicked off first so it runs
  // alongside the RLS-scoped withOrg batch below.
  const staffPromise = prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });

  const data = await withOrg(ctx.orgId, async (tx) => {
    const event = await tx.event.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        venueCompany: { select: { id: true, name: true } },
        venueContact: { select: { id: true, name: true } },
        invitees: {
          include: {
            contact: {
              select: { name: true, title: true, company: { select: { name: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        conversions: {
          include: { company: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!event) return null;
    const contacts = await tx.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: { select: { name: true } } },
    });
    const projects = await tx.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    // Members (companies) available to log as a conversion — those not already logged.
    const companies = await tx.company.findMany({
      where: { status: { in: [...NETWORK_STATUSES, "prospect"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, venue: true },
    });
    // Post-event debrief: the follow-up commitments and introductions anchored to
    // this event (both carry event_id).
    const followUpRows = await tx.actionItem.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        text: true,
        status: true,
        dueDate: true,
        ownerUser: { select: { name: true } },
        ownerContact: { select: { name: true } },
      },
    });
    const introRows = await tx.introduction.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        madeOn: true,
        partyA: { select: { name: true } },
        partyB: { select: { name: true } },
      },
    });
    return { event, contacts, projects, companies, followUpRows, introRows };
  });

  if (data == null) notFound();
  const { event, contacts, projects, companies, followUpRows, introRows } = data;
  const staffRows = await staffPromise;

  // Projected ROI (prototype roiSummary, Coterie.html:8340): net = ARR gained − cost;
  // roi% only meaningful when a cost is entered. ARR/cost are dollars.
  const cost = event.cost == null ? 0 : Number(event.cost);
  const arrGained = event.conversions.reduce(
    (t, c) => t + (c.arr == null ? 0 : Number(c.arr)),
    0,
  );
  const roiNet = arrGained - cost;
  const roiPct = cost > 0 ? Math.round((roiNet / cost) * 100) : null;

  const loggedCompanyIds = new Set(
    event.conversions.map((c) => c.companyId).filter((v): v is string => v != null),
  );
  const convertible = companies.filter((c) => !loggedCompanyIds.has(c.id));

  const invitedContactIds = new Set(
    event.invitees.map((i) => i.contactId).filter((v): v is string => v != null),
  );
  const invitable = contacts.filter((c) => !invitedContactIds.has(c.id));

  // The event's primary guest (the guest/company the event is built for), if set.
  const sponsor = event.invitees.find((i) => i.id === event.sponsorInviteeId) ?? null;
  const sponsorName = sponsor
    ? (sponsor.contact?.name ?? sponsor.externalName ?? "Guest")
    : null;
  const sponsorOrg = sponsor
    ? (sponsor.contact?.company?.name ?? sponsor.externalOrg ?? null)
    : null;

  // Network guests already on the list — the pool the outreach draft can write to
  // (external guests have no profile to ground a personal invitation in). Each
  // carries its persisted outreach stage + last draft so the panel seeds from it.
  const outreachGuests = event.invitees
    .filter((i) => i.contactId != null && i.contact != null)
    .map((i) => ({
      id: i.id,
      name: i.contact!.name,
      org: i.contact!.company?.name ?? null,
      status: i.outreachStatus,
      draft: i.outreachDraft,
    }));

  // Network guests keyed by CONTACT id — the pool for follow-up "they owe" owners
  // and for introductions made in the room (both write contact ids, not invitee ids).
  const guestContacts = event.invitees
    .filter((i) => i.contactId != null && i.contact != null)
    .map((i) => ({ id: i.contactId!, name: i.contact!.name }));

  const staff = staffRows.map((r) => r.user);

  const followUps: FollowUp[] = followUpRows.map((f) => ({
    id: f.id,
    text: f.text,
    status: f.status,
    dueDate: f.dueDate,
    ownerName: f.ownerUser?.name ?? f.ownerContact?.name ?? null,
    direction: f.ownerUser != null ? "we_owe" : "they_owe",
  }));

  const intros: EventIntro[] = introRows.map((i) => ({
    id: i.id,
    partyAName: i.partyA.name,
    partyBName: i.partyB.name,
    status: i.status,
    madeOn: i.madeOn,
  }));

  const eventDetails: EventDetails = {
    id: event.id,
    name: event.name,
    type: event.type,
    typeLabel: getEventType(event.type).label,
    stage: event.stage,
    date: event.date == null ? null : event.date.toISOString().slice(0, 10),
    dateLabel: event.date == null ? null : dateFmt.format(event.date),
    venue: event.venue,
    theme: event.theme,
    capacity: event.capacity,
    description: event.description ?? "",
    projectId: event.projectId,
    projectName: event.project?.name ?? null,
    venueCompanyId: event.venueCompanyId,
    venueCompanyName: event.venueCompany?.name ?? null,
    venueContactId: event.venueContactId,
    venueContactName: event.venueContact?.name ?? null,
  };

  // Venue names offered by member companies, each labelled with the company —
  // feeds the venue field's suggestion dropdown in the edit form.
  const venueOptions = companies
    .filter((c): c is { id: string; name: string; venue: string } => c.venue != null)
    .map((c) => ({ venue: c.venue, company: c.name }));

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

      <DetailsCard
        event={eventDetails}
        projects={projects}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
        venueOptions={venueOptions}
      />

      <Card>
        <CardHeader
          title={`Guest list (${event.invitees.length})`}
          action={
            event.invitees.some((i) => i.rsvp === RSVP_CONFIRMED) ? (
              <form action={markAllAttended}>
                <input type="hidden" name="eventId" value={event.id} />
                <button
                  type="submit"
                  className="text-[10px] font-medium tracking-[0.04em] text-ink-3 uppercase hover:text-gold"
                >
                  Mark confirmed as attended
                </button>
              </form>
            ) : undefined
          }
        />
        {sponsorName ? (
          <p className="border-b border-line-2 bg-gold-bg/40 px-4 py-2 text-[11px] text-ink-2">
            <span className="font-medium text-gold uppercase tracking-[0.06em] text-[10px]">
              Primary guest
            </span>{" "}
            <span className="font-medium">{sponsorName}</span>
            {sponsorOrg ? <span className="text-ink-3"> · {sponsorOrg}</span> : null}
            <span className="ml-1 text-ink-3">— the event is built for this guest.</span>
          </p>
        ) : null}
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
                <Th>Primary</Th>
                <Th> </Th>
              </>
            }
          >
            {event.invitees.map((i) => {
              const name = i.contact?.name ?? i.externalName ?? "Guest";
              const org = i.contact?.company?.name ?? i.externalOrg ?? "—";
              const title = i.contact?.title ?? i.externalTitle ?? null;
              const rsvp = getRsvpState(i.rsvp);
              return (
                <Tr key={i.id}>
                  <Td className="font-medium">
                    {name}
                    {title ? (
                      <span className="ml-1 text-[10px] text-ink-3">{title}</span>
                    ) : null}
                    {i.contactId == null ? (
                      <span className="ml-1.5 text-[9px] text-ink-3 italic">
                        external
                      </span>
                    ) : null}
                    {i.externalEmail ? (
                      <span className="ml-1.5 text-[10px] text-ink-3">
                        {i.externalEmail}
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
                    {i.id === event.sponsorInviteeId ? (
                      <form action={setEventSponsor} className="flex items-center gap-2">
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="inviteeId" value="" />
                        <TagBadge label="Primary" tone="gold" />
                        <button
                          type="submit"
                          className="text-[11px] text-ink-3 hover:text-red-ink"
                        >
                          Clear
                        </button>
                      </form>
                    ) : (
                      <form action={setEventSponsor}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="inviteeId" value={i.id} />
                        <button
                          type="submit"
                          className="text-[11px] text-ink-3 hover:text-gold"
                        >
                          Make primary
                        </button>
                      </form>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      {i.contactId == null ? (
                        <PromoteGuest
                          inviteeId={i.id}
                          eventId={event.id}
                          defaultCompany={i.externalOrg ?? ""}
                        />
                      ) : null}
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
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Shared suggestion list for the "Add to network" company field on every
          external-guest row — existing companies so promotion reuses one rather
          than duplicating it, while still allowing a new name. */}
      <datalist id="promote-company-names">
        {companies.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

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
          <Field name="externalTitle" label="Title / Role" placeholder="Managing Partner" />
          <Field name="externalEmail" label="Email" type="email" placeholder="jamie@rivera.co" />
          <div className="col-span-2 flex justify-end">
            <Button type="submit" variant="primary">
              Add guest
            </Button>
          </div>
        </form>
      </Card>

      <SuggestGuests eventId={event.id} />

      <FindTargets eventId={event.id} />

      <GuestBrief eventId={event.id} />

      {/* Key by the guest-id set: the panel owns local draft state, so it must
          only remount when a guest is added or removed — an RSVP change (which
          revalidates this page) must not wipe in-progress edits. */}
      <Outreach
        key={outreachGuests.map((g) => g.id).join(",")}
        eventId={event.id}
        guests={outreachGuests}
      />

      <Debrief
        eventId={event.id}
        notes={event.notes}
        followUps={followUps}
        intros={intros}
        staff={staff}
        guests={guestContacts}
      />

      <Card>
        <CardHeader title="Cost & ROI" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <form action={updateEventCost} className="flex items-end gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <Field
              name="cost"
              label="Event cost ($)"
              inputMode="numeric"
              defaultValue={event.cost == null ? "" : String(Number(event.cost))}
              placeholder="6000"
              className="flex-1"
            />
            <Button type="submit">Save</Button>
          </form>
          <div className="flex flex-col justify-center rounded-md border border-line bg-surface px-4 py-3">
            <div className="text-[9px] font-bold tracking-[0.08em] text-ink-3 uppercase">
              Projected ROI
            </div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span
                className={`font-serif text-[18px] ${
                  roiNet >= 0 ? "text-teal-ink" : "text-red-ink"
                }`}
              >
                {cost === 0 && arrGained === 0
                  ? "—"
                  : `$${(Math.abs(roiNet) / 1000).toFixed(0)}k ${
                      roiNet >= 0 ? "net gain" : "net loss"
                    }`}
              </span>
              {roiPct != null ? (
                <span className="text-[11px] text-ink-3">
                  {roiPct >= 0 ? "+" : ""}
                  {roiPct}% ROI
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[10px] text-ink-3">
              {cost ? `Cost: $${cost.toLocaleString()}` : "No cost entered"}
              {arrGained ? ` · ARR gained: $${arrGained.toLocaleString()}` : ""}
            </div>
          </div>
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
            New members from this event
          </div>
          <p className="mt-1 mb-3 text-[11px] leading-relaxed text-ink-3">
            Log any prospect or attendee who joined as a paying member as a direct
            result of this event. Their ARR counts toward the ROI above.
          </p>
          {event.conversions.length > 0 ? (
            <ul className="mb-3 divide-y divide-line rounded-md border border-line">
              {event.conversions.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-ink">
                      {c.company?.name ?? c.name}
                    </div>
                    <div className="text-[10px] text-ink-3">
                      {c.note || "Joined as a result of this event"}
                    </div>
                  </div>
                  <div className="text-[11px] text-ink-3">
                    {c.arr == null
                      ? "—"
                      : `$${(Number(c.arr) / 1000).toFixed(0)}k/yr`}
                  </div>
                  <form action={removeConversion}>
                    <input type="hidden" name="conversionId" value={c.id} />
                    <input type="hidden" name="eventId" value={event.id} />
                    <button
                      type="submit"
                      className="text-[11px] text-ink-3 hover:text-red-ink"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          <form action={addConversion} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <SelectField
              name="companyId"
              label="Member who joined"
              defaultValue=""
              className="min-w-[200px]"
            >
              <option value="">Select a member…</option>
              {convertible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <Field
              name="arr"
              label="ARR ($, optional)"
              inputMode="numeric"
              placeholder="member's annual value"
            />
            <Field
              name="note"
              label="Note (optional)"
              placeholder="Joined as Advisory after dinner"
            />
            <Button type="submit" variant="primary">
              Log conversion
            </Button>
          </form>
        </div>
      </Card>

      <DeleteEvent eventId={event.id} eventName={event.name} />
    </div>
  );
}
