import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import { loadIntroSuggestionSnapshot } from "@/lib/intro-suggestion-cache";
import { buildRelationshipTimeline } from "@/lib/relationship-timeline";
import { readMemberTierDefs } from "@/lib/member-tiers";
import { isModuleEnabled } from "@/lib/modules";
import { deriveInvoiceBalance, sumPayments } from "@/lib/invoice-status";
import { hasCredential } from "@/lib/integrations";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import { RSVP_CONFIRMED, RSVP_ATTENDED } from "@/lib/event-stages";
import { deriveValueEntries } from "@/lib/value-delivered";
import { PageTitle, TagBadge } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";

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
import { SecondDegreeCard } from "./_second-degree-card";
import { EmailCorrespondence } from "./_email-correspondence";
import { SavedArticlesCard } from "./_saved-articles";
import { RelationshipTimeline } from "./_timeline";
import { IntroductionsCard } from "./_introductions-card";
import { StatusPill } from "./_status-pill";
import { ProjectsCard } from "./_projects-card";
import { InvoicesCard } from "./_invoices-card";

// Company detail — the central relationship's home. Surfaces the company's own
// fields (including the slice-11.0 relationship attributes: what it's looking
// for / can offer, counties, deal size, network tags, owner, member-since) plus
// the relations we already have: contacts at the firm and the projects it
// participates in. Read withOrg-scoped; a lookup that returns null (not ours,
// or absent) is a 404.

// This page's AI server actions (company brief, meeting prep, intro suggestions)
// run an opus pass; give them headroom past Vercel's short default so they can
// finish instead of timing out.
export const maxDuration = 60;

const venueDateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
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
  const [staffRows, org, firefliesConnected] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    }),
    // Gate the profile's Fireflies-import row: only offer it when the org has
    // connected Fireflies (else every import would just error). Own withOrg tx.
    hasCredential(ctx.orgId, "fireflies"),
  ]);
  const staff = staffRows.map((m) => ({ id: m.user.id, name: m.user.name }));
  const tierDefs = readMemberTierDefs(org?.settings);
  // Only surface the invoice schedule when the org runs the invoices module.
  const invoicesEnabled = isModuleEnabled(org?.settings, "invoices");

  // Reads share one pooled connection inside the tx, so run them in sequence —
  // concurrent queries on a single pg client serialize and can stall the load.
  const {
    company,
    introductions,
    pendingIntros,
    meetings,
    secondDegree,
    emailMessages,
    newsItems,
    invoices,
    actionItems,
    statusChanges,
    valueDelivered,
    notes,
    eventsAttended,
    venueEvents,
    linkOptions,
    referralOptions,
    projects,
    networkContacts,
    introSuggestions,
  } = await withOrg(ctx.orgId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        include: {
          owner: { select: { name: true } },
          referredBy: { select: { id: true, name: true } },
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
          secondDegree: [],
          emailMessages: [],
          newsItems: [],
          invoices: [],
          actionItems: [],
          statusChanges: [],
          valueDelivered: [],
          notes: [],
          eventsAttended: [],
          venueEvents: [],
          linkOptions: [],
          referralOptions: [],
          projects: [],
          networkContacts: [],
          introSuggestions: null,
        };
      }
      // In-network companies offered in the Referred-by picker — this tenant's
      // companies minus the company itself. Their Network's link dropdown wants
      // the same list minus closed-out (former) relationships (strategic partners
      // only), so derive it here instead of issuing a second near-identical query.
      const referralOptions = await tx.company.findMany({
        where: { id: { not: id } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true, industry: true },
      });
      const linkOptions =
        company.status === "strategic_partner"
          ? referralOptions.filter((c) => c.status !== "former")
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
          headline: true,
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
      // Load ALL matched attendees (not just this company's) so the per-meeting
      // action-item picker can attribute an item to anyone who was in the room,
      // plus the meeting's persisted action items to render the extract UI.
      const meetings = contactIds.length
        ? await tx.meeting.findMany({
            where: { attendees: { some: { contactId: { in: contactIds } } } },
            orderBy: { heldAt: "desc" },
            select: {
              id: true,
              title: true,
              heldAt: true,
              summary: true,
              durationMinutes: true,
              location: true,
              firefliesId: true,
              attendees: {
                select: {
                  contactId: true,
                  contact: { select: { name: true } },
                },
              },
              actionItems: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  text: true,
                  status: true,
                  ownerUserId: true,
                  ownerContactId: true,
                  ownerUser: { select: { name: true } },
                  ownerContact: { select: { name: true } },
                },
              },
            },
          })
        : [];
      // Second-degree contacts (Members item 10): Fireflies attendees who sat in
      // one of THIS company's meetings but match no network contact. meetingIds on
      // the unmatched row intersecting this company's meeting ids scopes them to
      // people actually seen alongside this member — the profile offers "+ Add to
      // network".
      // Dismissed strangers are filtered here just as the dashboard panel does.
      const meetingIds = meetings.map((m) => m.id);
      const secondDegree = meetingIds.length
        ? await tx.unmatchedAttendee.findMany({
            where: { dismissedAt: null, meetingIds: { hasSome: meetingIds } },
            orderBy: { seenCount: "desc" },
            select: {
              id: true,
              email: true,
              inferredName: true,
              seenCount: true,
              lastMeetingTitle: true,
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
          doneActionItems: true,
          sentiment: true,
          emailDate: true,
          fromName: true,
          fromEmail: true,
          externalKey: true,
        },
      });
      // Saved coverage for this company (item 6). Same NewsItem ledger the
      // org-level News Intelligence page writes to; scoped to this company here.
      const newsItems = await tx.newsItem.findMany({
        where: { companyId: id },
        orderBy: { capturedAt: "desc" },
        take: 50,
        select: {
          id: true,
          headline: true,
          url: true,
          summary: true,
          capturedAt: true,
          projectId: true,
          project: { select: { name: true } },
        },
      });
      // This company's invoice schedule (only when the org runs the invoices
      // module). Payments ride along so the card can derive live status/balance;
      // ordered by due date so the schedule reads front-to-back.
      const invoices = invoicesEnabled
        ? await tx.invoice.findMany({
            where: { companyId: id },
            orderBy: [{ dueOn: "asc" }, { issuedOn: "asc" }],
            include: { payments: { select: { amount: true } } },
          })
        : [];
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
      // Every network contact — the cross-attribution pool for meeting action
      // items (an item can be owned by a member who wasn't at that meeting, then
      // surfaces on their own profile). Carries the company for the picker label.
      const networkContacts = await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          companyId: true,
          company: { select: { name: true } },
        },
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
          introductionId: true,
          introduction: {
            select: {
              partyA: { select: { name: true } },
              partyB: { select: { name: true } },
            },
          },
        },
      });
      // Manual relationship notes (item 24) — the one editable timeline source.
      const notes = await tx.note.findMany({
        where: { companyId: id },
        orderBy: { occurredAt: "desc" },
        take: 50,
        select: {
          id: true,
          body: true,
          occurredAt: true,
          author: { select: { name: true } },
        },
      });
      // Events this company's people came to (confirmed/attended) — a timeline
      // touchpoint AND a derived value-delivered entry. Deduped to one timeline
      // entry per event (a company may send several); rsvp/id feed the derived
      // value layer, createdAt is the occurredAt fallback for a date-less event.
      const eventInvites = contactIds.length
        ? await tx.eventInvitee.findMany({
            where: {
              contactId: { in: contactIds },
              rsvp: { in: [RSVP_CONFIRMED, RSVP_ATTENDED] },
            },
            select: {
              id: true,
              rsvp: true,
              event: {
                select: {
                  id: true,
                  name: true,
                  date: true,
                  createdAt: true,
                },
              },
            },
          })
        : [];
      // Events hosted at this company's venue (they own/provided the location) —
      // a "value add" this member gives the network. Read-only here; the link is
      // set on the event's Details card.
      const venueEvents = await tx.event.findMany({
        where: { venueCompanyId: id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          date: true,
          venue: true,
          venueContact: { select: { id: true, name: true } },
        },
      });
      // Last cached AI intro scan for this company (written by suggestIntros) —
      // lets the profile card hydrate instantly instead of re-firing a paid scan.
      const introSuggestions = await loadIntroSuggestionSnapshot(tx, id);
      return {
        company,
        introductions,
        pendingIntros,
        meetings,
        secondDegree,
        emailMessages,
        newsItems,
        invoices,
        actionItems,
        statusChanges,
        valueDelivered,
        notes,
        eventsAttended: eventInvites,
        venueEvents,
        linkOptions,
        referralOptions,
        projects,
        networkContacts,
        introSuggestions,
      };
    });

  if (company == null) notFound();

  // Shape meetings for the interactive card (a manual meeting — firefliesId
  // null — is removable; synced ones are read-only here). attendeeNames is
  // scoped to this company's people (the meta line), while attendees carries
  // every matched attendee for the action-item owner picker.
  const contactIdSet = new Set(company.contacts.map((c) => c.id));
  const meetingRows = meetings.map((m) => ({
    id: m.id,
    title: m.title,
    heldAt: m.heldAt,
    summary: m.summary,
    durationMinutes: m.durationMinutes,
    location: m.location,
    isManual: m.firefliesId == null,
    attendeeNames: m.attendees
      .filter((a) => contactIdSet.has(a.contactId))
      .map((a) => a.contact.name),
    attendees: m.attendees.map((a) => ({
      id: a.contactId,
      name: a.contact.name,
    })),
    actionItems: m.actionItems.map((it) => ({
      id: it.id,
      text: it.text,
      status: it.status,
      owner: it.ownerUser?.name ?? it.ownerContact?.name ?? "—",
      ownerKey: it.ownerUserId
        ? `staff:${it.ownerUserId}`
        : it.ownerContactId
          ? `contact:${it.ownerContactId}`
          : "",
    })),
  }));

  // Industry suggestions for the edit form's datalist — the distinct industries
  // already used across the org (incl. this company's), so an edit reuses an
  // existing label instead of introducing a typo'd variant.
  const industries = [
    ...new Set(
      [company.industry, ...referralOptions.map((c) => c.industry)].filter(
        (v): v is string => v.trim() !== "",
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Cross-attribution owner pool for meeting action items (all network contacts,
  // labelled by company); each meeting card filters out its own attendees.
  const networkOptions = networkContacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company.name,
  }));
  // Advisory dup-warning pool for the profile Contacts "Add" form (same
  // non-blocking check as the standalone add page).
  const existingContacts = networkContacts.map((c) => ({
    id: c.id,
    name: c.name,
    companyId: c.companyId,
    email: c.email,
    companyName: c.company.name,
  }));

  // Shape correspondence for the interactive card (manual rows — keyed manual:… —
  // are pasted on the profile; synced ones come from the Zapier email sync).
  const emailRows = emailMessages.map((e) => ({
    id: e.id,
    subject: e.subject,
    summary: e.summary,
    projects: e.projects,
    actionItems: e.actionItems,
    doneActionItems: e.doneActionItems,
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

  // One timeline entry per attended event (a company may send several guests).
  const attendedEvents = Array.from(
    new Map(
      eventsAttended
        .filter((e) => e.event.date != null)
        .map((e) => [
          e.event.id,
          { name: e.event.name, date: e.event.date as Date },
        ]),
    ).values(),
  );

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
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author?.name ?? null,
      date: n.occurredAt,
    })),
    values: valueDelivered.map((v) => ({
      summary: v.summary,
      outcome: v.outcome || null,
      date: v.occurredAt,
    })),
    events: attendedEvents,
    news: newsItems.map((n) => ({ headline: n.headline, date: n.capturedAt })),
  });

  // Derived network value (Phase 1, read-only) — the same enrichment the
  // shareable Value Report shows, surfaced inline so the profile card reflects
  // realized network activity (intros made, events attended, collaborations)
  // even before any dollar-tagged win is logged. All derived entries are
  // non-monetary (amount stays null); intros already in the manual ledger are
  // suppressed so nothing is double-counted. Reuses data already loaded above.
  // Collaborations = projects this company participates in (project_links), deduped
  // by project so a project surfaces once even when the company holds several roles
  // on it (the role-asc order keeps the first/earliest role as the label).
  const collabByProject = new Map<
    string,
    { projectId: string; projectName: string; role: string; occurredAt: Date }
  >();
  for (const l of company.projectLinks) {
    if (collabByProject.has(l.projectId)) continue;
    collabByProject.set(l.projectId, {
      projectId: l.projectId,
      projectName: l.project.name,
      role: l.role,
      occurredAt: l.createdAt,
    });
  }

  const derivedValue = deriveValueEntries({
    intros: introductions.map((i) => {
      // The other party — the company this member was introduced TO. Null for a
      // same-company intro so the summary never reads "Introduced to {own name}".
      const other = i.partyA.company?.id === company.id ? i.partyB : i.partyA;
      return {
        introId: i.id,
        status: i.status,
        headline: i.headline,
        outcome: i.outcome,
        madeOn: i.madeOn,
        createdAt: i.createdAt,
        partyAName: i.partyA.name,
        partyBName: i.partyB.name,
        counterpartCompany:
          other.company?.id === company.id ? null : (other.company?.name ?? null),
      };
    }),
    events: eventsAttended.map((iv) => ({
      inviteeId: iv.id,
      eventName: iv.event.name,
      rsvp: iv.rsvp,
      occurredAt: iv.event.date ?? iv.event.createdAt,
    })),
    collaborations: [...collabByProject.values()],
    ledgerIntroIds: new Set(
      valueDelivered
        .map((v) => v.introductionId)
        .filter((x): x is string => x != null),
    ),
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
          <StatusPill companyId={company.id} status={company.status} />
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
        {company.likelihood != null || company.referredById != null || company.referredByExternal ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
            {company.likelihood != null ? (
              <span className="flex items-center gap-1.5">
                Likelihood
                <span className="flex gap-0.5" aria-label={`${company.likelihood} of 5`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full ${
                        i <= company.likelihood! ? "bg-gold" : "bg-line-2"
                      }`}
                    />
                  ))}
                </span>
              </span>
            ) : null}
            {company.referredById != null ? (
              <Link
                href={`/dashboard/companies/${company.referredById}`}
                className="text-gold hover:underline"
              >
                ↗ Referred by {company.referredBy?.name}
              </Link>
            ) : company.referredByExternal ? (
              <span>↗ Referred by {company.referredByExternal}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <DetailsCard
        company={{
          id: company.id,
          name: company.name,
          status: company.status,
          tier: company.tier,
          tierLocked: company.tierLocked,
          likelihood: company.likelihood,
          referredById: company.referredById,
          referredByExternal: company.referredByExternal,
          referredByName: company.referredBy?.name ?? null,
          consulting: company.consulting,
          temperature: company.temperature,
          industry: company.industry,
          annualValue: Number(company.annualValue),
          website: company.website,
          linkedin: company.linkedin,
          emailDomain: company.emailDomain,
          primaryEmail:
            company.contacts.find((c) => c.isPrimary)?.email ??
            company.contacts.find((c) => c.email)?.email ??
            null,
          source: company.source,
          memberSince: company.memberSince,
          dealSize: company.dealSize,
          counties: company.counties,
          lookingFor: company.lookingFor,
          canOffer: company.canOffer,
          agencyContacts: company.agencyContacts,
          venue: company.venue,
          notes: company.notes,
          networkTags: company.networkTags,
          ownerName: company.owner?.name ?? null,
          ownerUserId: company.ownerUserId,
        }}
        staff={staff}
        tierDefs={tierDefs}
        referralOptions={referralOptions}
        industries={industries}
      />

      {company.status === "prospect" ? (
        <WhyJoin companyId={company.id} />
      ) : null}

      <MeetingPrep companyId={company.id} />

      <EnrichFromMeetings companyId={company.id} />

      <EnrichFromWeb companyId={company.id} />

      <AnalyzeDocument companyId={company.id} />

      <CompanyBrief companyId={company.id} />

      <IntroSuggestions companyId={company.id} initial={introSuggestions} />

      <IntroductionsCard
        companyId={company.id}
        intros={introductions.map((i) => ({
          id: i.id,
          status: i.status,
          outcome: i.outcome,
          partyAName: i.partyA.name,
          partyACompanyName: i.partyA.company.name,
          partyBName: i.partyB.name,
          partyBCompanyName: i.partyB.company.name,
        }))}
        pendingIntros={pendingIntros.map((d) => ({
          introId: d.introId,
          partyALabel: d.partyALabel,
          partyBLabel: d.partyBLabel,
          suggestedStage: d.suggestedStage,
          meetingTitle: d.meetingTitle,
          meetingDate: d.meetingDate,
        }))}
        partyAOptions={company.contacts.map((c) => ({ id: c.id, name: c.name }))}
        partyBOptions={networkOptions}
      />

      <ContactsCard
        companyId={company.id}
        existing={existingContacts}
        contacts={company.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          email: c.email,
          additionalEmails: c.additionalEmails,
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
          linkedin: a.linkedin,
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
        derived={derivedValue}
        intros={introductions.map((i) => ({
          id: i.id,
          label: `${i.partyA.name} ↔ ${i.partyB.name}`,
        }))}
      />

      <ProjectsCard
        companyId={company.id}
        links={company.projectLinks.map((l) => ({
          linkId: l.id,
          projectId: l.project.id,
          projectName: l.project.name,
          projectStage: l.project.stage,
          role: l.role,
        }))}
        // Every org project this company isn't already linked to.
        linkable={projects.filter(
          (p) => !company.projectLinks.some((l) => l.project.id === p.id),
        )}
      />

      {venueEvents.length > 0 ? (
        <CollapsibleCard id="company-venue-hosted" title="Venue hosted for us">
          <ul className="divide-y divide-line">
            {venueEvents.map((ev) => (
              <li key={ev.id} className="px-4 py-3 text-xs">
                <Link
                  href={`/dashboard/events/${ev.id}`}
                  className="font-medium text-ink hover:text-gold"
                >
                  {ev.name}
                </Link>
                <div className="mt-0.5 text-ink-3">
                  {[
                    ev.date == null ? null : venueDateFmt.format(ev.date),
                    ev.venue,
                    ev.venueContact == null
                      ? null
                      : `arranged by ${ev.venueContact.name}`,
                  ]
                    .filter((v): v is string => v != null && v !== "")
                    .join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      ) : null}

      <MeetingsCard
        companyId={company.id}
        meetings={meetingRows}
        contacts={company.contacts.map((c) => ({ id: c.id, name: c.name }))}
        staff={staff}
        networkContacts={networkOptions}
        firefliesConnected={firefliesConnected}
      />

      <SecondDegreeCard
        companyId={company.id}
        people={secondDegree.map((p) => ({
          id: p.id,
          name: p.inferredName?.trim() || p.email,
          email: p.email,
          seenCount: p.seenCount,
          lastMeetingTitle: p.lastMeetingTitle,
        }))}
      />

      <EmailCorrespondence companyId={company.id} messages={emailRows} />

      <SavedArticlesCard
        companyId={company.id}
        articles={newsItems.map((n) => ({
          id: n.id,
          headline: n.headline,
          url: n.url,
          summary: n.summary,
          capturedAt: n.capturedAt,
          projectId: n.projectId,
          projectName: n.project?.name ?? null,
        }))}
        // The article can be pinned to any project this company participates in
        // (deduped — a company may hold several roles on one project).
        projectOptions={[
          ...new Map(
            company.projectLinks.map((l) => [
              l.project.id,
              { id: l.project.id, name: l.project.name },
            ]),
          ).values(),
        ]}
      />

      {invoicesEnabled ? (
        <InvoicesCard
          companyId={company.id}
          invoices={invoices.map((inv) => {
            const { status, balance } = deriveInvoiceBalance(
              inv.status,
              inv.amount,
              sumPayments(inv.payments),
            );
            return {
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              amount: Number(inv.amount),
              balance: Number(balance),
              status,
              dueOn: inv.dueOn,
            };
          })}
        />
      ) : null}

      <CommitmentsCard
        companyId={company.id}
        currentUserId={ctx.userId}
        commitments={commitments}
        staff={staff}
        contacts={company.contacts.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects}
        moveTargets={referralOptions.map((c) => ({ id: c.id, name: c.name }))}
      />

      <RelationshipTimeline companyId={company.id} entries={timeline} />
    </div>
  );
}
