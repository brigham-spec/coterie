import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { getIntroStageDef } from "@/lib/intro-stages";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import { buildRelationshipTimeline } from "@/lib/relationship-timeline";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import {
  Button,
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

import { CompanyBrief } from "./_brief";
import { MeetingPrep } from "./_meeting-prep";
import { EnrichFromMeetings } from "./_enrich-meetings";
import { WhyJoin } from "./_why-join";
import { IntroSuggestions } from "./_intros";
import { DetailsCard } from "./_details-card";
import { ContactsCard } from "./_contacts-card";
import { confirmIntroAdvance } from "./actions";

// Company detail — the central relationship's home. Surfaces the company's own
// fields (including the slice-11.0 relationship attributes: what it's looking
// for / can offer, counties, deal size, network tags, owner, member-since) plus
// the relations we already have: contacts at the firm and the projects it
// participates in. Read withOrg-scoped; a lookup that returns null (not ours,
// or absent) is a 404.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Reads share one pooled connection inside the tx, so run them in sequence —
  // concurrent queries on a single pg client serialize and can stall the load.
  const {
    company,
    introductions,
    pendingIntros,
    meetings,
    actionItems,
    statusChanges,
  } = await withOrg(ctx.orgId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        include: {
          owner: { select: { name: true } },
          contacts: { orderBy: { name: "asc" } },
          projectLinks: {
            include: {
              project: { select: { id: true, name: true, stage: true } },
            },
            orderBy: { role: "asc" },
          },
        },
      });
      if (company == null) {
        return {
          company: null,
          introductions: [],
          pendingIntros: [],
          meetings: [],
          actionItems: [],
          statusChanges: [],
        };
      }
      const contactIds = company.contacts.map((c) => c.id);
      // This company's introductions from the ledger, either party. madeOn/
      // createdAt drive the relationship-timeline date.
      const introductions = await tx.introduction.findMany({
        where: {
          OR: [{ partyA: { companyId: id } }, { partyB: { companyId: id } }],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          outcome: true,
          madeOn: true,
          createdAt: true,
          partyA: {
            select: { name: true, company: { select: { id: true, name: true } } },
          },
          partyB: {
            select: { name: true, company: { select: { id: true, name: true } } },
          },
        },
      });
      // Fireflies-evidenced stage advances awaiting confirmation for this company.
      const pendingIntros = await loadPendingIntroDetections(tx, id);
      // Meetings any of this company's contacts attended (deduped by meeting).
      const meetings = contactIds.length
        ? await tx.meeting.findMany({
            where: { attendees: { some: { contactId: { in: contactIds } } } },
            orderBy: { heldAt: "desc" },
            select: { id: true, title: true, heldAt: true },
          })
        : [];
      // Commitments touching this company: items its contacts owe us
      // (ownerContactId) plus items we owe on meetings its people attended.
      const actionItems = contactIds.length
        ? await tx.actionItem.findMany({
            where: {
              OR: [
                { ownerContactId: { in: contactIds } },
                {
                  meeting: {
                    attendees: { some: { contactId: { in: contactIds } } },
                  },
                },
              ],
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              text: true,
              status: true,
              dueDate: true,
              ownerUserId: true,
              ownerContactId: true,
              updatedAt: true,
            },
          })
        : [];
      // Lifecycle transitions for the relationship timeline (P1). Ordered here
      // for the query; buildRelationshipTimeline re-sorts the merged set.
      const activities = await tx.activity.findMany({
        where: { companyId: id, type: ACTIVITY_STATUS_CHANGED },
        orderBy: { occurredAt: "desc" },
        select: { payload: true, occurredAt: true },
        take: 50,
      });
      const statusChanges = activities.map((a) => {
        const p = (a.payload ?? {}) as { from?: string | null; to?: string };
        return {
          from: p.from ?? null,
          to: String(p.to ?? ""),
          date: a.occurredAt,
        };
      });
      return {
        company,
        introductions,
        pendingIntros,
        meetings,
        actionItems,
        statusChanges,
      };
    });

  if (company == null) notFound();

  // Split open commitments by side; done items feed the relationship timeline.
  const openCommitments = actionItems.filter((a) => a.status === "open");
  const weOwe = openCommitments.filter((a) => a.ownerUserId != null);
  const theyOwe = openCommitments.filter((a) => a.ownerUserId == null);

  const timeline = buildRelationshipTimeline({
    addedAt: company.createdAt,
    meetings: meetings.map((m) => ({ title: m.title, heldAt: m.heldAt })),
    intros: introductions.map((i) => ({
      partyAName: i.partyA.name,
      partyBName: i.partyB.name,
      status: i.status,
      outcome: i.outcome,
      date: i.madeOn ?? i.createdAt,
    })),
    commitments: actionItems
      .filter((a) => a.status === "done")
      .map((a) => ({
        text: a.text,
        owedByUs: a.ownerUserId != null,
        date: a.updatedAt,
      })),
    statusChanges,
  });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/companies"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Companies
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle title={company.name} />
          <StatusBadge status={company.status} />
        </div>
        {company.networkTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {company.networkTags.map((key) => {
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

      <DetailsCard
        company={{
          id: company.id,
          status: company.status,
          tier: company.tier,
          temperature: company.temperature,
          industry: company.industry,
          annualValue: Number(company.annualValue),
          website: company.website,
          emailDomain: company.emailDomain,
          source: company.source,
          memberSince: company.memberSince,
          dealSize: company.dealSize,
          counties: company.counties,
          lookingFor: company.lookingFor,
          canOffer: company.canOffer,
          agencyContacts: company.agencyContacts,
          notes: company.notes,
          networkTags: company.networkTags,
          ownerName: company.owner?.name ?? null,
        }}
      />

      {company.status === "prospect" ? (
        <WhyJoin companyId={company.id} />
      ) : null}

      <MeetingPrep companyId={company.id} />

      <EnrichFromMeetings companyId={company.id} />

      <CompanyBrief companyId={company.id} />

      <IntroSuggestions companyId={company.id} />

      <Card>
        <CardHeader
          title="Introductions"
          action={
            pendingIntros.length > 0 ? (
              <span className="rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-semibold text-teal-ink">
                {pendingIntros.length} pending
              </span>
            ) : null
          }
        />
        {pendingIntros.length > 0 ? (
          <div className="border-b border-line bg-teal-bg/30 px-4 py-3">
            <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-teal-ink uppercase">
              Detected from meetings
            </div>
            <div className="flex flex-col gap-2">
              {pendingIntros.map((d) => (
                <form
                  key={d.introId}
                  action={confirmIntroAdvance}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="introId" value={d.introId} />
                  <input type="hidden" name="status" value={d.suggestedStage} />
                  <input type="hidden" name="companyId" value={company.id} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-medium text-ink">
                      {d.partyALabel}{" "}
                      <span className="text-ink-3">&#8596;</span>{" "}
                      {d.partyBLabel}
                      <span className="ml-1.5 text-[10px] text-teal-ink">
                        &#8594; {getIntroStageDef(d.suggestedStage).label}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-3">
                      Detected: {d.meetingTitle} &middot;{" "}
                      {dateFmt.format(d.meetingDate)}
                    </div>
                  </div>
                  <Button type="submit">Confirm</Button>
                </form>
              ))}
            </div>
          </div>
        ) : null}
        {introductions.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No introductions involving this company yet. Record one on the{" "}
            <Link href="/dashboard/introductions" className="text-gold underline">
              introductions
            </Link>{" "}
            page.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Parties</Th>
                <Th>Stage</Th>
              </>
            }
          >
            {introductions.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <div className="font-medium text-ink">
                    {i.partyA.name}
                    <span className="text-ink-3"> · {i.partyA.company.name}</span>
                  </div>
                  <div className="font-medium text-ink">
                    {i.partyB.name}
                    <span className="text-ink-3"> · {i.partyB.company.name}</span>
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
            ))}
          </Table>
        )}
      </Card>

      <ContactsCard
        companyId={company.id}
        contacts={company.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          linkedin: c.linkedin,
          notes: c.notes,
          tags: c.tags,
          isPrimary: c.isPrimary,
        }))}
      />

      <Card>
        <CardHeader title="Projects" />
        {company.projectLinks.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            Not linked to any projects yet.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Project</Th>
                <Th>Role</Th>
                <Th>Stage</Th>
              </>
            }
          >
            {company.projectLinks.map((l) => (
              <Tr key={l.projectId}>
                <Td className="font-medium">
                  <Link
                    href={`/dashboard/projects/${l.project.id}`}
                    className="hover:text-gold hover:underline"
                  >
                    {l.project.name}
                  </Link>
                </Td>
                <Td className="capitalize">{l.role.replace(/_/g, " ")}</Td>
                <Td>
                  <StatusBadge status={l.project.stage} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Meetings" />
        {meetings.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No meetings recorded with this company yet.
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
            {meetings.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.title}</Td>
                <Td>{dateFmt.format(m.heldAt)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Commitments" />
        {openCommitments.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No open commitments with this company.
          </p>
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                We owe
              </div>
              {weOwe.length === 0 ? (
                <p className="text-[11px] text-ink-3 italic">Nothing outstanding.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {weOwe.map((a) => (
                    <li key={a.id} className="text-xs text-ink-2">
                      {a.text}
                      {a.dueDate ? (
                        <span className="ml-1.5 text-[10px] text-ink-3">
                          · due {dateFmt.format(a.dueDate)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                They owe
              </div>
              {theyOwe.length === 0 ? (
                <p className="text-[11px] text-ink-3 italic">Nothing outstanding.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {theyOwe.map((a) => (
                    <li key={a.id} className="text-xs text-ink-2">
                      {a.text}
                      {a.dueDate ? (
                        <span className="ml-1.5 text-[10px] text-ink-3">
                          · due {dateFmt.format(a.dueDate)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Relationship timeline" />
        <ol className="flex flex-col gap-0 p-4">
          {timeline.map((e, idx) => (
            <li key={idx} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                {idx < timeline.length - 1 ? (
                  <span className="w-px flex-1 bg-line" />
                ) : null}
              </div>
              <div className="pb-4">
                <div className="text-xs font-medium text-ink">{e.label}</div>
                <div className="mt-0.5 text-[10px] text-ink-3">
                  {e.detail ? `${e.detail} · ` : ""}
                  {dateFmt.format(e.date)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
