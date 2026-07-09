import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getStageDef } from "@/lib/project-stages";
import {
  computeValueSummary,
  facilitatedValue,
  impactIsEmpty,
  parseEconomicImpact,
  parseServices,
  type ValueCompany,
  type ValueProject,
} from "@/lib/value-created";
import {
  Card,
  CardHeader,
  PageTitle,
  StatusBadge,
  TagBadge,
} from "@/components/ui";

// Value Created (slice 11.8) — the economic value the network has facilitated for
// the region: deals moved forward through introductions, service-fee revenue, and
// regional economic impact. Read-only analytics; one withOrg pass loads projects
// (with participants) + companies (RLS-scoped to this tenant), and the pure rollup
// in @/lib/value-created does the attribution math.

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Compact money for headline tiles: $1.2M / $340K / $0.
function money(n: number): string {
  if (n <= 0) return "TBD";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return dollars.format(n);
}

function loadValueData(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const projects = await tx.project.findMany({
      orderBy: { name: "asc" },
      include: {
        projectLinks: { include: { company: { select: { name: true } } } },
      },
    });
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        industry: true,
        annualValue: true,
        services: true,
        contacts: {
          where: { isPrimary: true },
          select: { name: true },
          take: 1,
        },
      },
    });
    return { projects, companies };
  });
}

function stageHistoryStages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) =>
      typeof h === "object" && h !== null && "stage" in h
        ? String((h as { stage: unknown }).stage)
        : "",
    )
    .filter((s) => s.length > 0);
}

export default async function ValueCreatedPage() {
  const ctx = await requireOrgContext();
  const { projects, companies } = await loadValueData(ctx.orgId);

  const valueProjects: ValueProject[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    stage: p.stage,
    county: p.county,
    description: p.description || null,
    value: p.value == null ? null : Number(p.value),
    realizedValue: p.realizedValue == null ? null : Number(p.realizedValue),
    memberNames: p.projectLinks.map((l) => l.company.name),
    stageHistory: stageHistoryStages(p.stageHistory),
    economicImpact: parseEconomicImpact(p.economicImpact),
  }));

  const valueCompanies: ValueCompany[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    contactName: c.contacts[0]?.name ?? null,
    industry: c.industry,
    annualValue: Number(c.annualValue),
    services: parseServices(c.services),
  }));

  const s = computeValueSummary(valueProjects, valueCompanies);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-2 flex items-center justify-between">
        <PageTitle
          title="Value Created"
          subtitle="Regional economic value the network has facilitated — deals moved forward through introductions."
        />
        <Link
          href="/dashboard/projects"
          className="shrink-0 text-[11px] text-ink-3 hover:text-gold"
        >
          Project pipeline →
        </Link>
      </div>

      <div className="mt-5 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="Facilitated deal value"
          value={money(s.facilitatedValue)}
          note={`${s.memberConnectedCount} member-connected`}
        />
        <Metric
          label="Multi-member deals"
          value={String(s.multiMemberCount)}
          note="2+ members — clearest attribution"
        />
        <Metric
          label="Service fee revenue"
          value={money(s.serviceFeeRevenue)}
          note="IDA + capital placement"
        />
        <Metric
          label="Network multiplier"
          value={s.networkMultiplier == null ? "—" : `${s.networkMultiplier.toFixed(1)}×`}
          note="value per membership $"
        />
        <Metric
          label="Active pipeline"
          value={money(s.activePipelineValue)}
          note="member-connected, in flight"
        />
      </div>

      {!impactIsEmpty(s.impact) ? (
        <Card>
          <CardHeader title="Economic impact" />
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="FT jobs created" value={numOrDash(s.impact.permanentJobs)} note="permanent positions" plain />
            <Metric label="Construction jobs" value={numOrDash(s.impact.constructionJobs)} note="during build phase" plain />
            <Metric label="Construction cost" value={money(s.impact.constructionCost)} note="across tracked projects" plain />
            <Metric label="Tax abatements" value={money(s.impact.taxAbatementValue)} note="active agreements" plain />
            <Metric label="Grants secured" value={money(s.impact.grantsSecured)} note="awarded / received" plain />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Active services"
          action={<Count n={s.activeServices.length} tone="teal" />}
        />
        {s.activeServices.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No active services yet. Track IDA navigation or capital placement on a
            company profile.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {s.activeServices.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <Link
                  href={`/dashboard/companies/${c.id}`}
                  className="text-[12.5px] font-medium text-ink hover:text-gold"
                >
                  {c.name}
                </Link>
                <div className="mt-0.5 text-[10px] text-ink-3">
                  {[c.contactName, c.industry].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.services.ida ? (
                    <TagBadge
                      tone="teal"
                      label={`IDA ${c.services.ida.status || "active"}${
                        c.services.ida.valueSecured > 0
                          ? ` · ${money(c.services.ida.valueSecured)} secured`
                          : ""
                      }`}
                    />
                  ) : null}
                  {c.services.capital ? (
                    <TagBadge
                      tone="slate"
                      label={`Capital ${c.services.capital.status || "active"}${
                        c.services.capital.valueSecured > 0
                          ? ` · ${money(c.services.capital.valueSecured)} placed`
                          : ""
                      }`}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Multi-member deals"
          action={<Count n={s.multiMemberCount} tone="gold" />}
        />
        {s.multiMemberDeals.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No multi-member projects yet. Link 2+ companies to a project to track
            deal attribution.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {s.multiMemberDeals.map((p) => (
              <DealRow key={p.id} project={p} />
            ))}
          </ul>
        )}
      </Card>

      {s.memberConnectedPipeline.length > 0 ? (
        <Card>
          <CardHeader
            title="Member-connected pipeline"
            action={<Count n={s.memberConnectedPipeline.length} tone="teal" />}
          />
          <ul className="divide-y divide-line">
            {s.memberConnectedPipeline.map((p) => {
              const val = facilitatedValue(p);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="text-[12.5px] font-medium text-ink hover:text-gold"
                    >
                      {p.name}
                    </Link>
                    <div className="mt-0.5 text-[10px] text-ink-3">
                      {p.memberNames[0]}
                      {p.county ? ` · ${p.county} Co.` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-semibold text-teal-ink">
                      {val > 0 ? money(val) : "—"}
                    </div>
                    <StatusBadge status={p.stage} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function DealRow({ project: p }: { project: ValueProject }) {
  const val = facilitatedValue(p);
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/projects/${p.id}`}
              className="text-[13px] font-medium text-ink hover:text-gold"
            >
              {p.name}
            </Link>
            <StatusBadge status={p.stage} />
            {p.county ? (
              <span className="text-[10px] text-ink-3">{p.county} Co.</span>
            ) : null}
          </div>
          <div className="mt-1 text-[10.5px] text-ink-3">
            {p.memberNames.join(" × ")}
          </div>
          {p.description ? (
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-ink-3">
              {p.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          {val > 0 ? (
            <>
              <div className="text-[14px] font-semibold text-teal-ink">
                {money(val)}
              </div>
              <div className="text-[9.5px] text-ink-3">
                {p.realizedValue != null ? "Realized" : "Pipeline est."}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-ink-3">Value TBD</div>
          )}
          <div className="mt-0.5 text-[10px] text-ink-3">
            {p.memberNames.length} members
          </div>
        </div>
      </div>
      {p.stageHistory.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {p.stageHistory.map((st, i) => (
            <span
              key={`${st}-${i}`}
              className={
                st === p.stage
                  ? "rounded-full bg-teal-bg px-1.5 py-0.5 text-[9px] text-teal-ink"
                  : "rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] text-ink-3"
              }
            >
              {getStageDef(st).label}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function numOrDash(n: number): string {
  return n > 0 ? n.toLocaleString() : "—";
}

function Metric({
  label,
  value,
  note,
  plain,
}: {
  label: string;
  value: string;
  note: string;
  plain?: boolean;
}) {
  return (
    <div
      className={
        plain
          ? ""
          : "rounded-md border border-line bg-surface px-4 py-3 shadow-card"
      }
    >
      <div className="font-serif text-[18px] text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-[9.5px] text-ink-3">{note}</div>
    </div>
  );
}

function Count({ n, tone }: { n: number; tone: "teal" | "gold" }) {
  return <TagBadge tone={tone} label={String(n)} />;
}
