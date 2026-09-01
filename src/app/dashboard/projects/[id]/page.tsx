import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PROJECT_STAGES, TERMINAL_STAGES } from "@/lib/project-stages";
import { buildStageTimeline } from "@/lib/stage-history";
import { openRoles } from "@/lib/disciplines";
import { parseImpactForm } from "@/lib/value-created";
import { parseHvServices } from "@/lib/hv-services";
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  SelectField,
  StatusBadge,
} from "@/components/ui";

import { updateStage } from "../actions";
import { DeleteProject } from "./_delete-project";
import { EditDetails } from "./_edit-details";
import { OpenRoles } from "./_open-roles";
import {
  DeliverablesCard,
  type DeliverableRow,
} from "./_deliverables";
import {
  ParticipantsCard,
  type ParticipantRow,
  type ParticipantContactOption,
} from "./_participants";
import { FundingCard, type FundingRow } from "./_funding";
import { EconomicImpactCard } from "./_economic-impact";
import { HvServicesCard } from "./_hv-services";
import { AssistanceCard } from "./_assistance";
import { ProjectNewsScanner } from "./_news-scanner";
import { ProjectNewsPanel } from "./_news-updates";

import { parseAssistanceKeys } from "@/lib/project-assistance";

// Project detail — the seat of company participation. project_links carries
// composite FKs to projects(id, org_id) and companies(id, org_id), so a link can
// never straddle orgs; the read below is withOrg-scoped so nothing foreign shows.
// A participant is one company (or off-network person) in a role with an optional
// primary contact; a company may appear in several roles.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// Stage-history dates are stored as UTC "YYYY-MM-DD"; pin formatting to UTC so the
// rendered day can't drift by the server's timezone (and can't mismatch on hydrate).
const stageDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});


// The open-role scan (scanOpenRole) runs an opus pass; give its server action
// headroom past Vercel's short default so it can finish instead of timing out.
export const maxDuration = 60;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModule("projects");
  const { id } = await params;
  const ctx = await requireOrgContext();

  const data = await withOrg(ctx.orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      include: {
        developer: { select: { id: true, name: true } },
        projectLinks: {
          include: {
            company: { select: { name: true, status: true } },
            contact: { select: { name: true } },
          },
          orderBy: { role: "asc" },
        },
      },
    });
    if (!project) return null;
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    // Every contact in the tenant (RLS-scoped). Powers both the participant
    // primary-contact picker (filtered client-side by the chosen company) and the
    // deliverable "they owe" owner pool (contacts at a company already on the
    // project). Company names come from the `companies` roster above, so no join.
    const allContacts = await tx.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyId: true },
    });
    // Funding sources & grants tracked on this project (RLS-scoped).
    const fundingSources = await tx.fundingSource.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
    });
    // Deliverables = action_items attached to this project, plus the "they owe"
    // owner pool (contacts at a company on the project). Both reads are RLS-scoped.
    const deliverables = await tx.actionItem.findMany({
      where: { projectId: id },
      include: {
        ownerUser: { select: { name: true } },
        ownerContact: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    // Off-network participants carry a null company; drop them for the
    // company-scoped news + owner-pool derivations below.
    const companyIds = project.projectLinks
      .map((l) => l.companyId)
      .filter((cid): cid is string => cid !== null);
    // Press & News = saved news items explicitly cross-linked to this project
    // (News audit item 5) plus coverage saved across the participant companies
    // (read-only here; capture/link/removal live on /dashboard/news and company
    // profiles). RLS-scoped like the rest.
    const newsItems = await tx.newsItem.findMany({
      where: {
        OR: [
          { projectId: id },
          ...(companyIds.length === 0 ? [] : [{ companyId: { in: companyIds } }]),
        ],
      },
      orderBy: { capturedAt: "desc" },
      take: 15,
      select: {
        id: true,
        headline: true,
        url: true,
        summary: true,
        capturedAt: true,
        projectId: true,
        company: { select: { name: true } },
      },
    });
    return {
      project,
      companies,
      allContacts,
      companyIds,
      fundingSources,
      deliverables,
      newsItems,
    };
  });

  if (data == null) notFound();
  const {
    project,
    companies,
    allContacts,
    companyIds,
    fundingSources,
    deliverables,
    newsItems,
  } = data;

  // Staff owners = org members ("we owe"). org_memberships has no RLS, so scope
  // it explicitly by org (mirrors owner reassignment on the company profile).
  const staffRows = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });
  const staff = staffRows.map((r) => r.user);

  // Companies already on the project — the "they owe" deliverable owner pool is
  // limited to their contacts. Reuses the null-filtered ids computed above.
  const linkedCompanyIds = new Set(companyIds);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const contactOptions = allContacts
    .filter((c) => linkedCompanyIds.has(c.companyId))
    .map((c) => ({
      id: c.id,
      name: c.name,
      companyName: companyNameById.get(c.companyId) ?? "",
    }));
  // The participant primary-contact picker offers every contact (filtered
  // client-side by the chosen company).
  const participantContacts: ParticipantContactOption[] = allContacts.map((c) => ({
    id: c.id,
    name: c.name,
    companyId: c.companyId,
  }));
  const participantRows: ParticipantRow[] = project.projectLinks.map((l) => ({
    id: l.id,
    role: l.role,
    companyId: l.companyId,
    companyName: l.company?.name ?? null,
    companyStatus: l.company?.status ?? null,
    contactId: l.contactId,
    contactName: l.contact?.name ?? null,
    name: l.name,
    org: l.org,
    email: l.email,
  }));
  const deliverableRows: DeliverableRow[] = deliverables.map((d) => ({
    id: d.id,
    text: d.text,
    status: d.status,
    direction: d.ownerUserId ? "we_owe" : "they_owe",
    ownerId: d.ownerUserId ?? d.ownerContactId ?? "",
    ownerName: d.ownerUser?.name ?? d.ownerContact?.name ?? "Unassigned",
  }));
  const fundingRows: FundingRow[] = fundingSources.map((f) => ({
    id: f.id,
    name: f.name,
    agency: f.agency,
    category: f.category,
    estimatedBenefit: f.estimatedBenefit,
    status: f.status,
    rationale: f.rationale,
    action: f.action,
    notes: f.notes,
    aiSuggested: f.aiSuggested,
  }));

  // Stage history reads the trail updateStage appends to; newest-first for display.
  const timeline = buildStageTimeline(project.stageHistory);

  // Economic impact + HVEDC services — the editable Json columns feeding Value
  // Created and Revenue reporting. Parsed to the raw form shape for the cards.
  const impact = parseImpactForm(project.economicImpact);
  const services = parseHvServices(project.hvServices);

  // What the project is asking the org to help with (equity, CFA, IDA, grants,
  // entitlements, …) — an intake/needs signal distinct from the delivered services.
  const assistance = parseAssistanceKeys(project.assistanceRequested);

  // Companies eligible as the developer/lead (any in the tenant).
  const developerId = project.developerMemberId ?? "";

  // Manual "Add link" + "Review updates from news" both save/read against a
  // company (news_items.company_id is required), so they need one company to
  // attach to: prefer the developer, else the first participant company. Null
  // when the project has no linked company at all — the panel disables itself.
  const attachCompanyId = project.developer?.id ?? companyIds[0] ?? null;

  // Open roles = disciplines not yet staffed on the team. Only meaningful while the
  // project is live — a completed / on-hold project isn't hiring.
  const isActive = !TERMINAL_STAGES.includes(project.stage);
  const unfilledRoles = openRoles(project.projectLinks.map((l) => l.role));

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Type", value: project.type },
    { label: "Industry", value: project.industry },
    { label: "County", value: project.county },
    {
      label: "Units / keys",
      value: project.units == null ? null : String(project.units),
    },
    {
      label: "Sq ft",
      value: project.sqft == null ? null : project.sqft.toLocaleString("en-US"),
    },
    {
      label: "Value",
      value: project.value == null ? null : currency.format(Number(project.value)),
    },
    {
      label: "Realized value",
      value:
        project.realizedValue == null
          ? null
          : currency.format(Number(project.realizedValue)),
    },
    { label: "Developer (member)", value: project.developer?.name ?? null },
    { label: "Developer / lead", value: project.prospectLead },
    {
      label: "Target date",
      value: project.targetDate == null ? null : dateFmt.format(project.targetDate),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/projects"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Projects
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle
            title={project.name}
            subtitle={project.description || undefined}
          />
          <StatusBadge status={project.stage} />
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
          action={updateStage}
          className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <SelectField
            name="stage"
            label="Advance stage"
            defaultValue={project.stage}
            className="min-w-[200px]"
          >
            {PROJECT_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <Button type="submit">Update stage</Button>
        </form>
        <EditDetails
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
            type: project.type,
            industry: project.industry,
            county: project.county,
            units: project.units,
            sqft: project.sqft,
            value: project.value == null ? null : String(project.value),
            realizedValue:
              project.realizedValue == null ? null : String(project.realizedValue),
            targetDate:
              project.targetDate == null
                ? null
                : project.targetDate.toISOString().slice(0, 10),
            prospectLead: project.prospectLead,
          }}
          developerId={developerId}
          companies={companies}
        />
      </Card>

      {timeline.length > 0 ? (
        <Card>
          <CardHeader title="Stage history" />
          <ul className="flex flex-col">
            {[...timeline].reverse().map((e) => (
              <li
                key={`${e.stage}-${e.date}`}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={e.stage} />
                  <span className="text-[11px] text-ink-3">
                    {stageDateFmt.format(new Date(`${e.date}T00:00:00Z`))}
                  </span>
                </div>
                <span className="text-[11px] text-ink-2">
                  {e.days} {e.days === 1 ? "day" : "days"}
                  {e.isCurrent ? " in current stage" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ParticipantsCard
        projectId={project.id}
        participants={participantRows}
        companies={companies}
        contacts={participantContacts}
      />

      <DeliverablesCard
        projectId={project.id}
        deliverables={deliverableRows}
        staff={staff}
        contacts={contactOptions}
      />

      <FundingCard projectId={project.id} sources={fundingRows} />

      <AssistanceCard projectId={project.id} selected={assistance} />

      <EconomicImpactCard projectId={project.id} impact={impact} />

      <HvServicesCard projectId={project.id} services={services} />

      <Card>
        <CardHeader title="Press & News" />
        <ProjectNewsPanel
          projectId={project.id}
          attachCompanyId={attachCompanyId}
          hasNews={newsItems.length > 0}
        />
        {newsItems.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No saved news for the participant companies yet. Capture coverage on{" "}
            <Link href="/dashboard/news" className="text-gold underline">
              News
            </Link>
            , or scan the web below.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {/* Articles cross-linked to THIS project (item 5) lead, then the
                company-derived coverage — a stable sort keeps capturedAt-desc
                within each group. */}
            {[...newsItems]
              .sort(
                (a, b) =>
                  Number(b.projectId === project.id) -
                  Number(a.projectId === project.id),
              )
              .map((n) => (
                <li key={n.id} className="flex flex-col gap-1 px-4 py-3">
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12.5px] font-medium text-ink hover:text-gold hover:underline"
                  >
                    {n.headline}
                  </a>
                  {n.summary ? (
                    <p className="line-clamp-2 text-[10.5px] text-ink-3">
                      {n.summary}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 text-[10px] text-ink-3">
                    {n.projectId === project.id ? (
                      <span className="rounded-sm bg-gold-bg px-1.5 py-0.5 font-medium text-gold-ink">
                        Linked
                      </span>
                    ) : null}
                    <span>{n.company.name}</span>
                    <span>·</span>
                    <span>{dateFmt.format(n.capturedAt)}</span>
                  </div>
                </li>
              ))}
          </ul>
        )}
        <ProjectNewsScanner projectId={project.id} />
      </Card>

      {isActive && unfilledRoles.length > 0 ? (
        <OpenRoles projectId={project.id} roles={unfilledRoles} />
      ) : null}

      <DeleteProject projectId={project.id} projectName={project.name} />
    </div>
  );
}
