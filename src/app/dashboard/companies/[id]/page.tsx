import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  Card,
  CardHeader,
  PageTitle,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

// Company detail — the central relationship's home, and the future seat of the
// AI brief (item 5), news/activities (item 6), and invoices (item 7). For now it
// surfaces the company's own fields plus the relations we already have: contacts
// at the firm and the projects it participates in. Read withOrg-scoped; a lookup
// that returns null (not ours, or absent) is a 404.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const company = await withOrg(ctx.orgId, (tx) =>
    tx.company.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { name: "asc" } },
        projectLinks: {
          include: { project: { select: { id: true, name: true, stage: true } } },
          orderBy: { role: "asc" },
        },
      },
    }),
  );

  if (company == null) notFound();

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Industry", value: company.industry },
    { label: "Tier", value: company.tier },
    { label: "Annual value", value: currency.format(Number(company.annualValue)) },
    {
      label: "Temperature",
      value: company.temperature == null ? null : String(company.temperature),
    },
    { label: "Source", value: company.source },
    { label: "Email domain", value: company.emailDomain },
    { label: "Website", value: company.website },
  ];

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
        {company.notes ? (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              Notes
            </div>
            <p className="text-xs whitespace-pre-wrap text-ink-2">{company.notes}</p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Contacts" />
        {company.contacts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No contacts yet. Add one on the{" "}
            <Link href="/dashboard/contacts" className="text-gold underline">
              contacts
            </Link>{" "}
            page.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Title</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
              </>
            }
          >
            {company.contacts.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">
                  {c.name}
                  {c.isPrimary ? (
                    <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
                      Primary
                    </span>
                  ) : null}
                </Td>
                <Td>{c.title ?? "—"}</Td>
                <Td>{c.email ?? "—"}</Td>
                <Td>{c.phone ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

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
    </div>
  );
}
