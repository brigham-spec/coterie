import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { ACTIVE_COMMITMENT_STATUSES } from "@/lib/commitments";
import { readMemberTiers } from "@/lib/member-tiers";
import {
  staleTone,
  tallyIntrosByCompany,
  tallyOpenActionsByCompany,
  type StaleTone,
} from "@/lib/company-list";
import {
  AddDisclosure,
  Button,
  Card,
  CardHeader,
  PageTitle,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";

import { AddCompanyForm } from "./_add-company-form";
import { CompanyFilters } from "./_filters";
import { LinkedInParse } from "./_linkedin-parse";
import { BatchSynth } from "./_batch-synth";
import { OwnerCell, TierCell, TagsCell, ValueCell } from "./_inline-edit";

// Companies — the network's central table (build item 4, enriched in slice 11.2).
// The list is filtered and sorted entirely from the URL query string (segment /
// q / owner / tag / sort) so every view is shareable and server-rendered. We
// load the tenant's companies once (a bounded set) with each owner and primary
// contact, compute the segment/tag facets from the full set, then filter and
// sort in memory. RLS scopes the read to this tenant via withOrg.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type Segment = { key: string; label: string; match: (status: string) => boolean };

const SEGMENTS: Segment[] = [
  { key: "all", label: "All", match: () => true },
  { key: "members", label: "Members", match: (s) => s === "member" },
  { key: "partners", label: "Partners", match: (s) => s === "strategic_partner" },
  { key: "prospects", label: "Prospects", match: (s) => s === "prospect" },
  { key: "former", label: "Former", match: (s) => s === "former" },
];

const DAY = 86_400_000;

function relContact(date: Date | null, now: Date): string {
  if (date == null) return "—";
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Full class strings per staleness bucket (Tailwind JIT needs literals). Mirrors
// the dashboard Needs-a-Call red/amber, with teal for a fresh contact.
const STALE_CLASS: Record<StaleTone, string> = {
  fresh: "text-teal-ink",
  warm: "text-gold-ink",
  stale: "text-red-ink",
  none: "text-ink-3",
};

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Consulting / IDA engagement → list badge (mirrors the prototype): an "IDA"
// mention gets its own tag, any other non-empty note reads as "Consulting".
function consultingTag(consulting: string | null): string | null {
  if (!consulting) return null;
  return /\bida\b/i.test(consulting) ? "IDA" : "Consulting";
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;

  const segmentKey = one(sp.segment) || "all";
  const q = one(sp.q).trim().toLowerCase();
  const ownerFilter = one(sp.owner);
  const tagFilter = one(sp.tag);
  const tierFilter = one(sp.tier);
  const industryFilter = one(sp.industry);
  const likelihoodFilter = Number(one(sp.likelihood)) || 0;
  const sort = one(sp.sort) || "name";
  const now = new Date();

  // Companies (RLS-scoped) plus the per-company open-action and introduction
  // tallies (both bounded per-tenant reads, attributed in memory), and the org's
  // configured member tiers (organizations carry no RLS — a plain query). The
  // tier list orders the filter facet.
  const [{ companies, openActionByCompany, introByCompany }, org, staffRows] =
    await Promise.all([
      withOrg(ctx.orgId, async (tx) => {
        const companies = await tx.company.findMany({
          orderBy: { name: "asc" },
          include: {
            owner: { select: { id: true, name: true } },
            contacts: {
              where: { isPrimary: true },
              take: 1,
              select: { name: true },
            },
          },
        });
        const actionRows = await tx.actionItem.findMany({
          where: { status: { in: [...ACTIVE_COMMITMENT_STATUSES] } },
          select: {
            companyId: true,
            ownerContact: { select: { companyId: true } },
          },
        });
        const introRows = await tx.introduction.findMany({
          select: {
            partyA: { select: { companyId: true } },
            partyB: { select: { companyId: true } },
          },
        });
        return {
          companies,
          openActionByCompany: tallyOpenActionsByCompany(actionRows),
          introByCompany: tallyIntrosByCompany(introRows),
        };
      }),
      prisma.organization.findUnique({
        where: { id: ctx.orgId },
        select: { settings: true },
      }),
      // Full org staff list for the inline owner picker (org_memberships carry no
      // RLS — scope by orgId).
      prisma.orgMembership.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { user: { name: "asc" } },
        select: { user: { select: { id: true, name: true } } },
      }),
    ]);
  const configuredTiers = readMemberTiers(org?.settings);
  const staff = staffRows.map((m) => ({ id: m.user.id, name: m.user.name }));

  const segment = SEGMENTS.find((s) => s.key === segmentKey) ?? SEGMENTS[0];

  // Segment counts from the full set (so tabs show totals, not the filtered view).
  const segmentCounts = new Map(
    SEGMENTS.map((s) => [s.key, companies.filter((c) => s.match(c.status)).length]),
  );

  // Owner + tag + tier facets, derived from what's actually present in the
  // network (so we only offer filters that would match something).
  const ownerMap = new Map<string, string>();
  const tagSet = new Set<string>();
  const tierSet = new Set<string>();
  const industryCount = new Map<string, number>();
  for (const c of companies) {
    if (c.owner) ownerMap.set(c.owner.id, c.owner.name);
    for (const t of c.networkTags) tagSet.add(t);
    if (c.tier) tierSet.add(c.tier);
    if (c.industry)
      industryCount.set(c.industry, (industryCount.get(c.industry) ?? 0) + 1);
  }
  // Industry quick-chips — the industries present, busiest first (name tie-break).
  const industries = [...industryCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const owners = [...ownerMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...tagSet]
    .map((key) => ({ key, label: getTagDef(key).label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Present tiers ordered by the org's configured order; any not in the config
  // (a legacy value) sorts last, alphabetically.
  const tierRank = new Map(configuredTiers.map((t, i) => [t, i]));
  const tiers = [...tierSet].sort((a, b) => {
    const ra = tierRank.get(a) ?? Infinity;
    const rb = tierRank.get(b) ?? Infinity;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });

  const filtered = companies
    .filter((c) => segment.match(c.status))
    .filter((c) =>
      q === ""
        ? true
        : c.name.toLowerCase().includes(q) ||
          c.industry.toLowerCase().includes(q),
    )
    .filter((c) => (ownerFilter ? c.ownerUserId === ownerFilter : true))
    .filter((c) => (tagFilter ? c.networkTags.includes(tagFilter) : true))
    .filter((c) => (tierFilter ? c.tier === tierFilter : true))
    .filter((c) => (industryFilter ? c.industry === industryFilter : true))
    .filter((c) =>
      likelihoodFilter ? (c.likelihood ?? 0) >= likelihoodFilter : true,
    );

  const rows = [...filtered].sort((a, b) => {
    if (sort === "value") return Number(b.annualValue) - Number(a.annualValue);
    if (sort === "recent") {
      const at = a.lastContactAt?.getTime() ?? 0;
      const bt = b.lastContactAt?.getTime() ?? 0;
      return bt - at;
    }
    if (sort === "actions") {
      const ac = openActionByCompany.get(a.id) ?? 0;
      const bc = openActionByCompany.get(b.id) ?? 0;
      return bc - ac || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  const totalValue = rows.reduce((t, c) => t + Number(c.annualValue), 0);

  // Build a list href from the active filters with a patch applied — so a segment
  // tab or industry chip preserves every other filter and only changes its own.
  function makeHref(patch: Record<string, string>): string {
    const base: Record<string, string> = {
      segment: segmentKey === "all" ? "" : segmentKey,
      q: one(sp.q),
      owner: ownerFilter,
      tag: tagFilter,
      tier: tierFilter,
      industry: industryFilter,
      likelihood: likelihoodFilter ? String(likelihoodFilter) : "",
      sort: sort === "name" ? "" : sort,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...base, ...patch }))
      if (value) params.set(key, value);
    const query = params.toString();
    return query ? `/dashboard/companies?${query}` : "/dashboard/companies";
  }
  const segmentHref = (key: string) =>
    makeHref({ segment: key === "all" ? "" : key });
  // Clicking the active industry chip clears it.
  const industryHref = (name: string) =>
    makeHref({ industry: industryFilter === name ? "" : name });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <PageTitle
          title="Companies"
          subtitle={`${companies.length} in ${ctx.orgName}'s network`}
        />
        {ctx.role === "admin" ? (
          <Link href="/dashboard/companies/import">
            <Button>Import CSV</Button>
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Add company" />
        <AddDisclosure label="+ Add a company">
          <AddCompanyForm
            existing={companies.map((c) => ({ id: c.id, name: c.name }))}
          />
        </AddDisclosure>
      </Card>

      <LinkedInParse />

      <BatchSynth
        companies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
        }))}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-3 py-2">
          {SEGMENTS.map((s) => {
            const active = s.key === segment.key;
            return (
              <Link
                key={s.key}
                href={segmentHref(s.key)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-ink text-white"
                    : "text-ink-3 hover:bg-surface-3 hover:text-ink",
                )}
              >
                {s.label}
                <span className={cn("ml-1.5", active ? "text-white/60" : "text-ink-3")}>
                  {segmentCounts.get(s.key)}
                </span>
              </Link>
            );
          })}
        </div>

        {industries.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
            {industries.map((ind) => {
              const active = industryFilter === ind.name;
              return (
                <Link
                  key={ind.name}
                  href={industryHref(ind.name)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10.5px] transition-colors",
                    active
                      ? "bg-ink text-white"
                      : "bg-surface-2 text-ink-3 hover:bg-surface-3 hover:text-ink",
                  )}
                >
                  {ind.name}
                  <span className={cn("ml-1", active ? "text-white/60" : "text-ink-3")}>
                    {ind.count}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}

        <CompanyFilters owners={owners} tags={tags} tiers={tiers} />

        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No companies match this view.
          </p>
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Company</Th>
                  <Th>Owner</Th>
                  <Th>Tier</Th>
                  <Th>Tags</Th>
                  <Th>Value</Th>
                  <Th>Last contact</Th>
                </>
              }
            >
              {rows.map((c) => {
                const openActions = openActionByCompany.get(c.id) ?? 0;
                const introCount = introByCompany.get(c.id) ?? 0;
                const consulting = consultingTag(c.consulting);
                return (
                  <Tr key={c.id}>
                    <Td className="font-medium">
                      <Link
                        href={`/dashboard/companies/${c.id}`}
                        className="hover:text-gold hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] font-normal text-ink-3">
                        <StatusBadge status={c.status} />
                        {c.industry ? <span>{c.industry}</span> : null}
                        {openActions > 0 ? (
                          <span
                            className="rounded-sm bg-gold-bg px-1.5 py-0.5 text-[9.5px] text-gold-ink"
                            title={`${openActions} open action item${openActions === 1 ? "" : "s"}`}
                          >
                            {openActions} open
                          </span>
                        ) : null}
                        {introCount > 0 ? (
                          <span
                            className="rounded-sm bg-teal-bg px-1.5 py-0.5 text-[9.5px] text-teal-ink"
                            title={`${introCount} introduction${introCount === 1 ? "" : "s"}`}
                          >
                            {introCount} intro{introCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {consulting ? (
                          <span className="rounded-sm border border-line-2 px-1.5 py-0.5 text-[9.5px] tracking-[0.04em] text-ink-2 uppercase">
                            {consulting}
                          </span>
                        ) : null}
                      {c.likelihood != null ? (
                        <span
                          className="flex gap-0.5"
                          aria-label={`Likelihood ${c.likelihood} of 5`}
                        >
                          {[1, 2, 3, 4, 5].map((i) => (
                            <span
                              key={i}
                              className={`h-1 w-1 rounded-full ${
                                i <= c.likelihood! ? "bg-gold" : "bg-line-2"
                              }`}
                            />
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <OwnerCell
                      companyId={c.id}
                      ownerUserId={c.ownerUserId}
                      ownerName={c.owner?.name ?? null}
                      staff={staff}
                    />
                  </Td>
                  <Td className="text-ink-2">
                    <TierCell
                      companyId={c.id}
                      tier={c.tier}
                      tiers={configuredTiers}
                    />
                  </Td>
                  <Td>
                    <TagsCell companyId={c.id} tags={c.networkTags} />
                  </Td>
                  <Td>
                    <ValueCell
                      companyId={c.id}
                      value={String(c.annualValue)}
                      display={currency.format(Number(c.annualValue))}
                    />
                  </Td>
                  <Td className={STALE_CLASS[staleTone(c.lastContactAt, now)]}>
                    {relContact(c.lastContactAt, now)}
                  </Td>
                </Tr>
                );
              })}
            </Table>
            <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-ink-3">
              <span>
                {rows.length} {rows.length === 1 ? "company" : "companies"}
              </span>
              <span>{currency.format(totalValue)} total value</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
