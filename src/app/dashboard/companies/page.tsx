import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { COMPANY_STATUS_DEFS } from "@/lib/company-statuses";
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
  cn,
} from "@/components/ui";

import { createCompany } from "./actions";
import { CompanyFilters } from "./_filters";
import { LinkedInParse } from "./_linkedin-parse";
import { BatchSynth } from "./_batch-synth";

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

const statusOptions = COMPANY_STATUS_DEFS;

type Segment = { key: string; label: string; match: (status: string) => boolean };

const SEGMENTS: Segment[] = [
  { key: "all", label: "All", match: () => true },
  { key: "members", label: "Members", match: (s) => s === "member" },
  { key: "partners", label: "Partners", match: (s) => s === "strategic_partner" },
  { key: "prospects", label: "Prospects", match: (s) => s === "prospect" },
  { key: "former", label: "Former", match: (s) => s === "former" },
];

const DAY = 86_400_000;

function relContact(date: Date | null): string {
  if (date == null) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
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
  const sort = one(sp.sort) || "name";

  const companies = await withOrg(ctx.orgId, (tx) =>
    tx.company.findMany({
      orderBy: { name: "asc" },
      include: {
        owner: { select: { id: true, name: true } },
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: { name: true },
        },
      },
    }),
  );

  const segment = SEGMENTS.find((s) => s.key === segmentKey) ?? SEGMENTS[0];

  // Segment counts from the full set (so tabs show totals, not the filtered view).
  const segmentCounts = new Map(
    SEGMENTS.map((s) => [s.key, companies.filter((c) => s.match(c.status)).length]),
  );

  // Owner + tag facets, derived from what's actually present in the network.
  const ownerMap = new Map<string, string>();
  const tagSet = new Set<string>();
  for (const c of companies) {
    if (c.owner) ownerMap.set(c.owner.id, c.owner.name);
    for (const t of c.networkTags) tagSet.add(t);
  }
  const owners = [...ownerMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...tagSet]
    .map((key) => ({ key, label: getTagDef(key).label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = companies
    .filter((c) => segment.match(c.status))
    .filter((c) =>
      q === ""
        ? true
        : c.name.toLowerCase().includes(q) ||
          c.industry.toLowerCase().includes(q),
    )
    .filter((c) => (ownerFilter ? c.ownerUserId === ownerFilter : true))
    .filter((c) => (tagFilter ? c.networkTags.includes(tagFilter) : true));

  const rows = [...filtered].sort((a, b) => {
    if (sort === "value") return Number(b.annualValue) - Number(a.annualValue);
    if (sort === "recent") {
      const at = a.lastContactAt?.getTime() ?? 0;
      const bt = b.lastContactAt?.getTime() ?? 0;
      return bt - at;
    }
    return a.name.localeCompare(b.name);
  });

  const totalValue = rows.reduce((t, c) => t + Number(c.annualValue), 0);

  // Segment tab hrefs preserve the active filters (but reset nothing else).
  function segmentHref(key: string): string {
    const params = new URLSearchParams();
    if (key !== "all") params.set("segment", key);
    if (q) params.set("q", one(sp.q));
    if (ownerFilter) params.set("owner", ownerFilter);
    if (tagFilter) params.set("tag", tagFilter);
    if (sort !== "name") params.set("sort", sort);
    const query = params.toString();
    return query ? `/dashboard/companies?${query}` : "/dashboard/companies";
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Companies"
          subtitle={`${companies.length} in ${ctx.orgName}'s network`}
        />
      </div>

      <Card>
        <CardHeader title="Add company" />
        <details className="group">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs text-ink-3 hover:text-ink">
            <span className="group-open:hidden">+ Add a company</span>
            <span className="hidden group-open:inline">Cancel</span>
          </summary>
          <form
            action={createCompany}
            className="grid grid-cols-2 gap-4 border-t border-line p-4"
          >
            <Field
              name="name"
              label="Company name"
              placeholder="Acme Corp"
              required
              className="col-span-2"
            />
            <SelectField name="status" label="Status" defaultValue="prospect">
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <Field
              name="industry"
              label="Industry"
              placeholder="Manufacturing"
              required
            />
            <Field
              name="annualValue"
              label="Annual value (USD)"
              placeholder="0"
              inputMode="decimal"
            />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Add company
              </Button>
            </div>
          </form>
        </details>
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

        <CompanyFilters owners={owners} tags={tags} />

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
                  <Th>Tags</Th>
                  <Th>Value</Th>
                  <Th>Last contact</Th>
                </>
              }
            >
              {rows.map((c) => (
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
                    </div>
                  </Td>
                  <Td>{c.owner?.name ?? "—"}</Td>
                  <Td>
                    {c.networkTags.length === 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.networkTags.slice(0, 3).map((key) => {
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
                        {c.networkTags.length > 3 ? (
                          <span className="text-[10px] text-ink-3">
                            +{c.networkTags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </Td>
                  <Td>{currency.format(Number(c.annualValue))}</Td>
                  <Td className="text-ink-2">{relContact(c.lastContactAt)}</Td>
                </Tr>
              ))}
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
