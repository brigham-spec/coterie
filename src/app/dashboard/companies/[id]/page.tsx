import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { getIntroStageDef } from "@/lib/intro-stages";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import { buildRelationshipTimeline } from "@/lib/relationship-timeline";
import { readMemberTiers } from "@/lib/member-tiers";
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
import { EnrichFromWeb } from "./_enrich-web";
import { AnalyzeDocument } from "./_analyze-document";
import { WhyJoin } from "./_why-join";
import { IntroSuggestions } from "./_intros";
import { DetailsCard } from "./_details-card";
import { ContactsCard } from "./_contacts-card";
import { AffiliationsCard } from "./_affiliations-card";
import { PartnershipCard } from "./_partnership-card";
import { TheirNetworkCard } from "./_their-network-card";
import { ProposalsCard } from "./_proposals-card";
import { ValueDeliveredCard } from "./_value-delivered-card";
import { CommitmentsCard } from "./_commitments-card";
import { MeetingsCard } from "./_meetings-card";
import { EmailCorrespondence } from "./_email-correspondence";
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
  timeZone: "UTC",
});

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Org staff for the owner picker, and the org's configured member tiers for
  // the Tier dropdown. org_memberships and organizations carry no RLS, so these
  // are plain queries scoped explicitly by orgId.
  const [staffRows, org] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    }),
  ]);
  const staff = staffRows.map((m) => ({ id: m.user.id, name: m.user.name }));
  const memberTiers = readMemberTiers(org?.settings);

  // Reads share one pooled connection inside the tx, so run them in sequence —
  // concurrent queries on a single pg client serialize and can stall the load.
  const {
    company,
    introductions,
    pendingIntros,
    meetings,
    emailMessages,
    actionItems,
    statusChanges,
    valueDelivered,
    linkOptions,
    projects,
  } = await withOrg(ctx.orgId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        include: {
          owner: { select: { name: true } },
          contacts: { orderBy: { name: "asc" } },
          affiliations: { orderBy: { createdAt: "asc" } },
          keyRelationships: {
            orderBy: { createdAt: "asc" },
            include: { linkedCompany: { select: { id: true, name: true } } },
          },
          membershipProposals: { orderBy: { createdAt: "desc" } },
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
          emailMessages: [],
          actionItems: [],
          statusChanges: [],
          valueDelivered: [],
          linkOptions: [],
          projects: [],
        };
      }
      // Companies offered in Their Network's link dropdown — only needed (and
      // loaded) for strategic partners. This tenant's companies minus the
      // partner itself and closed-out (former) relationships.
      const linkOptions =
        company.status === "strategic_partner"
          ? await tx.company.findMany({
              where: { id: { not: id }, status: { not: "former" } },
              orderBy: { name: "asc" },
              select: { id: true, name: true },
            })
          : [];
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
            select: {
              id: true,
              title: true,
              heldAt: true,
              summary: true,
              firefliesId: true,
              attendees: {
                where: { contactId: { in: contactIds } },
                select: { contact: { select: { name: true } } },
              },
            },
          })
        : [];
      // All correspondence for this company — synced (Zapier) + manual (pasted on
      // the profile). Manual rows are keyed manual:… so the card can tag them.
      const emailMessages = await tx.emailMessage.findMany({
        where: { companyId: id },
        orderBy: { syncedAt: "desc" },
        take: 50,
        select: {
          id: true,
          subject: true,
          summary: true,
          projects: true,
          actionItems: true,
          sentiment: true,
          emailDate: true,
          fromName: true,
          fromEmail: true,
          externalKey: true,
        },
      });
      // Commitments touching this company: manual ones logged on the profile
      // (companyId), items its contacts owe us (ownerContactId), plus items we
      // owe on meetings its people attended.
      const actionItems = await tx.actionItem.findMany({
        where: {
          OR: [
            { companyId: id },
            ...(contactIds.length
              ? [
                  { ownerContactId: { in: contactIds } },
                  {
                    meeting: {
                      attendees: { some: { contactId: { in: contactIds } } },
                    },
                  },
                ]
              : []),
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
          projectId: true,
          updatedAt: true,
          ownerUser: { select: { name: true } },
          ownerContact: { select: { name: true } },
          project: { select: { name: true } },
        },
      });
      // Org projects for the commitment project-picker (optional link).
      const projects = await tx.project.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
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
      // Per-company Value Delivered ledger (P4). The linked introduction's
      // parties label the entry so a win reads back to its source intro.
      const valueDelivered = await tx.valueDelivered.findMany({
        where: { companyId: id },
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          kind: true,
          amount: true,
          summary: true,
          outcome: true,
          occurredAt: true,
          introduction: {
            select: {
              partyA: { select: { name: true } },
              partyB: { select: { name: true } },
            },
          },
        },
      });
      return {
        company,
        introductions,
        pendingIntros,
        meetings,
        emailMessages,
        actionItems,
        statusChanges,
        valueDelivered,
        linkOptions,
        projects,
      };
    });

  if (company == null) notFound();

  // Shape meetings for the interactive card (a manual meeting — firefliesId
  // null — is removable; synced ones are read-only here).
  const meetingRows = meetings.map((m) => ({
    id: m.id,
    title: m.title,
    heldAt: m.heldAt,
    summary: m.summary,
    isManual: m.firefliesId == null,
    attendeeNames: m.attendees.map((a) => a.contact.name),
  }));

  // Shape correspondence for the interactive card (manual rows — keyed manual:… —
  // are pasted on the profile; synced ones come from the Zapier email sync).
  const emailRows = emailMessages.map((e) => ({
    id: e.id,
    subject: e.subject,
    summary: e.summary,
    projects: e.projects,
    actionItems: e.actionItems,
    sentiment: e.sentiment,
    emailDate: e.emailDate,
    fromName: e.fromName,
    fromEmail: e.fromEmail,
    isManual: e.externalKey.startsWith("manual:"),
  }));

  // Shape commitments for the interactive card; done items feed the timeline.
  const commitments = actionItems.map((a) => ({
    id: a.id,
    text: a.text,
    status: a.status,
    dueDate: a.dueDate,
    ownerUserId: a.ownerUserId,
    ownerName: a.ownerUser?.name ?? a.ownerContact?.name ?? null,
    projectName: a.project?.name ?? null,
  }));

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
          ownerUserId: company.ownerUserId,
        }}
        staff={staff}
        memberTiers={memberTiers}
      />

      {company.status === "prospect" ? (
        <WhyJoin companyId={company.id} />
      ) : null}

      <MeetingPrep companyId={company.id} />

      <EnrichFromMeetings companyId={company.id} />

      <EnrichFromWeb companyId={company.id} />

      <AnalyzeDocument companyId={company.id} />

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

      <AffiliationsCard
        companyId={company.id}
        affiliations={company.affiliations.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          industry: a.industry,
          website: a.website,
          canOffer: a.canOffer,
          lookingFor: a.lookingFor,
          counties: a.counties,
          dealSize: a.dealSize,
        }))}
      />

      {company.status === "strategic_partner" ? (
        <>
          <PartnershipCard
            companyId={company.id}
            partnership={{
              website: company.website ?? "",
              partnerCategory: company.partnerCategory,
              partnerRelationship: company.partnerRelationship,
              partnerSummary: company.partnerSummary,
              collaborationNotes: company.collaborationNotes,
            }}
          />
          <TheirNetworkCard
            companyId={company.id}
            relationships={company.keyRelationships.map((r) => ({
              id: r.id,
              name: r.name,
              title: r.title,
              org: r.org,
              relevance: r.relevance,
              email: r.email,
              phone: r.phone,
              linkedCompanyId: r.linkedCompanyId,
              linkedCompanyName: r.linkedCompany?.name ?? null,
            }))}
            linkOptions={linkOptions}
          />
        </>
      ) : null}

      <ProposalsCard
        companyId={company.id}
        proposals={company.membershipProposals.map((p) => ({
          id: p.id,
          tier: p.tier,
          amount: p.amount == null ? null : Number(p.amount),
          status: p.status,
          sentOn: p.sentOn,
          driveUrl: p.driveUrl,
          notes: p.notes,
        }))}
      />

      <ValueDeliveredCard
        companyId={company.id}
        entries={valueDelivered.map((v) => ({
          id: v.id,
          kind: v.kind,
          amount: v.amount == null ? null : Number(v.amount),
          summary: v.summary,
          outcome: v.outcome,
          occurredAt: v.occurredAt,
          introLabel: v.introduction
            ? `${v.introduction.partyA.name} ↔ ${v.introduction.partyB.name}`
            : null,
        }))}
        intros={introductions.map((i) => ({
          id: i.id,
          label: `${i.partyA.name} ↔ ${i.partyB.name}`,
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

      <MeetingsCard
        companyId={company.id}
        meetings={meetingRows}
        contacts={company.contacts.map((c) => ({ id: c.id, name: c.name }))}
      />

      <EmailCorrespondence companyId={company.id} messages={emailRows} />

      <CommitmentsCard
        companyId={company.id}
        currentUserId={ctx.userId}
        commitments={commitments}
        staff={staff}
        contacts={company.contacts.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects}
      />

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
