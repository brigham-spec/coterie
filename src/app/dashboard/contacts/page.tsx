import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { COMPANY_SEGMENTS, companySegmentMatches } from "@/lib/company-list";
import { filterContacts } from "@/lib/contact-list";
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";

import { AddContactForm } from "./_add-contact-form";
import { ContactFilters } from "./_filters";

// Contacts — people at the tenant's companies (build item 4). A contact must
// belong to a company, so the create form is a company-scoped select. Both the
// company options and the contact list are read through withOrg (RLS-scoped) in
// a single transaction, so nothing outside this tenant is ever visible. The list
// is filtered entirely from the URL query string (segment / q / company / tag /
// primary) so every view is shareable — and the CSV export reuses the same query
// so the download matches the current view (mirrors the companies list).

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;

  const segmentKey = one(sp.segment) || "all";
  const q = one(sp.q).trim().toLowerCase();
  const companyFilter = one(sp.company);
  const tagFilter = one(sp.tag);
  const primaryOnly = one(sp.primary) === "1";

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const { companies, contacts } = await withOrg(ctx.orgId, async (tx) => {
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const contacts = await tx.contact.findMany({
      orderBy: { name: "asc" },
      include: { company: { select: { name: true, status: true } } },
    });
    return { companies, contacts };
  });

  // Each contact flattened to the shape the shared filter reads (the segment is
  // the contact's COMPANY status).
  const rowsForFilter = contacts.map((c) => ({
    ...c,
    companyName: c.company.name,
    companyStatus: c.company.status,
  }));

  // Segment counts from the full set (so tabs show totals, not the filtered view).
  const segmentCounts = new Map(
    COMPANY_SEGMENTS.map((s) => [
      s.key,
      rowsForFilter.filter((c) => companySegmentMatches(s.key, c.companyStatus))
        .length,
    ]),
  );
  const segment =
    COMPANY_SEGMENTS.find((s) => s.key === segmentKey) ?? COMPANY_SEGMENTS[0];

  // Facets derived from what's actually present (so we only offer filters that
  // would match something): the companies that have contacts, and the contact
  // tags in use.
  const companyMap = new Map<string, string>();
  const tagSet = new Set<string>();
  for (const c of rowsForFilter) {
    companyMap.set(c.companyId, c.companyName);
    for (const t of c.tags) tagSet.add(t);
  }
  const companyFacet = [...companyMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tagFacet = [...tagSet]
    .map((key) => ({ key, label: getTagDef(key).label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = filterContacts(rowsForFilter, {
    segment: segmentKey,
    q,
    company: companyFilter,
    tag: tagFilter,
    primaryOnly,
  });

  // Build a list href from the active filters with a patch applied — so a segment
  // tab preserves every other filter and only changes its own.
  function makeHref(patch: Record<string, string>): string {
    const base: Record<string, string> = {
      segment: segmentKey === "all" ? "" : segmentKey,
      q: one(sp.q),
      company: companyFilter,
      tag: tagFilter,
      primary: primaryOnly ? "1" : "",
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...base, ...patch }))
      if (value) params.set(key, value);
    const query = params.toString();
    return query ? `/dashboard/contacts?${query}` : "/dashboard/contacts";
  }
  const segmentHref = (key: string) =>
    makeHref({ segment: key === "all" ? "" : key });
  // The CSV export carries the active filters (reusing makeHref's query so the
  // two can't drift) to the export route, so the download matches the view.
  const listQuery = makeHref({}).split("?")[1] ?? "";
  const exportHref = listQuery
    ? `/dashboard/contacts/export?${listQuery}`
    : "/dashboard/contacts/export";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <PageTitle
          title="Contacts"
          subtitle={`${contacts.length} across ${ctx.orgName}'s network`}
        />
        {ctx.role === "admin" && contacts.length > 0 ? (
          // A Route Handler download (CSV attachment), not a page — a plain <a>
          // (dynamic href) so the browser navigates and saves the file. A dynamic
          // href doesn't trip no-html-link-for-pages the way a static one would.
          <a href={exportHref}>
            <Button>Export CSV</Button>
          </a>
        ) : null}
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardHeader title="Add contact" />
          <p className="px-4 py-6 text-xs text-ink-3">
            Add a{" "}
            <Link href="/dashboard/companies" className="text-gold underline">
              company
            </Link>{" "}
            first — every contact belongs to one.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Add contact" />
          <AddContactForm
            companies={companies}
            existing={contacts.map((c) => ({
              id: c.id,
              name: c.name,
              companyId: c.companyId,
              email: c.email,
              companyName: c.company.name,
            }))}
          />
        </Card>
      )}

      <Card>
        <CardHeader title="People" />
        {contacts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No contacts yet.{companies.length > 0 ? " Add one above." : ""}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-3 py-2">
              {COMPANY_SEGMENTS.map((s) => {
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
                    <span
                      className={cn(
                        "ml-1.5",
                        active ? "text-white/60" : "text-ink-3",
                      )}
                    >
                      {segmentCounts.get(s.key)}
                    </span>
                  </Link>
                );
              })}
            </div>

            <ContactFilters companies={companyFacet} tags={tagFacet} />

            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-xs text-ink-3">
                No contacts match this view.
              </p>
            ) : (
              <>
                <Table
                  head={
                    <>
                      <Th>Name</Th>
                      <Th>Title</Th>
                      <Th>Company</Th>
                      <Th>Email</Th>
                      <Th>Phone</Th>
                    </>
                  }
                >
                  {filtered.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-medium">
                        <Link
                          href={`/dashboard/contacts/${c.id}`}
                          className="hover:text-gold hover:underline"
                        >
                          {c.name}
                        </Link>
                        {c.isPrimary ? (
                          <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
                            Primary
                          </span>
                        ) : null}
                      </Td>
                      <Td>{c.title ?? "—"}</Td>
                      <Td>{c.company.name}</Td>
                      <Td>{c.email ?? "—"}</Td>
                      <Td>{c.phone ?? "—"}</Td>
                    </Tr>
                  ))}
                </Table>
                <div className="px-4 py-2.5 text-[11px] text-ink-3">
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "contact" : "contacts"}
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
