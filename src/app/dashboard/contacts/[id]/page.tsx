import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import {
  Card,
  CardHeader,
  PageTitle,
  StatusBadge,
  TagBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

// Contact detail — a person's home in the CRM. Surfaces their own fields (title,
// email, phone, LinkedIn, tags, notes) and the relations that make a contact
// worth a click-through: introductions they're a party to, meetings they've
// attended, and action items they own ("they owe"). Read withOrg-scoped; a
// lookup that returns null (not ours, or absent) is a 404.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Reads share one pooled connection inside the tx, so run them in sequence —
  // concurrent queries on a single pg client serialize and can stall the load.
  const { contact, introductions, meetings, actionItems } = await withOrg(
    ctx.orgId,
    async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { id },
        include: {
          company: { select: { id: true, name: true, status: true } },
        },
      });
      // Introductions this contact is a party to, either side.
      const introductions = await tx.introduction.findMany({
        where: { OR: [{ partyAContactId: id }, { partyBContactId: id }] },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          outcome: true,
          partyAContactId: true,
          partyA: {
            select: { id: true, name: true, company: { select: { name: true } } },
          },
          partyB: {
            select: { id: true, name: true, company: { select: { name: true } } },
          },
        },
      });
      // Meetings this contact was an attendee of, most recent first.
      const meetings = await tx.meetingAttendee.findMany({
        where: { contactId: id },
        orderBy: { meeting: { heldAt: "desc" } },
        select: {
          confirmed: true,
          meeting: { select: { id: true, title: true, heldAt: true } },
        },
      });
      // Commitments this contact owns ("they owe").
      const actionItems = await tx.actionItem.findMany({
        where: { ownerContactId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, text: true, status: true, dueDate: true },
      });
      return { contact, introductions, meetings, actionItems };
    },
  );

  if (contact == null) notFound();

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Title", value: contact.title },
    { label: "Email", value: contact.email },
    { label: "Phone", value: contact.phone },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/contacts"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Contacts
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle title={contact.name} />
          {contact.isPrimary ? (
            <span className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
              Primary
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-ink-3">
          <Link
            href={`/dashboard/companies/${contact.company.id}`}
            className="hover:text-gold hover:underline"
          >
            {contact.company.name}
          </Link>
          <span className="ml-2 align-middle">
            <StatusBadge status={contact.company.status} />
          </span>
        </div>
        {contact.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contact.tags.map((key) => {
              const def = getTagDef(key);
              return (
                <TagBadge
                  key={key}
                  label={def.label}
                  tone={def.tone}
                  title={def.desc}
                />
              );
            })}
          </div>
        ) : null}
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
          <div>
            <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              LinkedIn
            </dt>
            <dd className="text-ink">
              {contact.linkedin ? (
                <a
                  href={contact.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold hover:underline"
                >
                  Profile
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {contact.notes ? (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              Notes
            </div>
            <p className="text-xs whitespace-pre-wrap text-ink-2">{contact.notes}</p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Introductions" />
        {introductions.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No introductions involving this contact yet.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Counterparty</Th>
                <Th>Stage</Th>
              </>
            }
          >
            {introductions.map((i) => {
              // Show the OTHER party from this contact's viewpoint.
              const other = i.partyAContactId === id ? i.partyB : i.partyA;
              return (
                <Tr key={i.id}>
                  <Td>
                    <div className="font-medium text-ink">
                      {other.name}
                      <span className="text-ink-3"> · {other.company.name}</span>
                    </div>
                    {i.outcome ? (
                      <div className="mt-1 text-[10px] text-ink-3 italic">
                        {i.outcome}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Meetings" />
        {meetings.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No meetings recorded with this contact yet.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Meeting</Th>
                <Th>Date</Th>
              </>
            }
          >
            {meetings.map((a) => (
              <Tr key={a.meeting.id}>
                <Td className="font-medium">
                  {a.meeting.title}
                  {!a.confirmed ? (
                    <span className="ml-2 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                      Unconfirmed
                    </span>
                  ) : null}
                </Td>
                <Td>{dateFmt.format(a.meeting.heldAt)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Owes us" />
        {actionItems.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No open commitments from this contact.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Item</Th>
                <Th>Due</Th>
                <Th>Status</Th>
              </>
            }
          >
            {actionItems.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium">{a.text}</Td>
                <Td>{a.dueDate ? dateFmt.format(a.dueDate) : "—"}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
