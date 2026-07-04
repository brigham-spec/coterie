import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { linkCompany } from "../actions";

// Project detail — the seat of company participation. project_links carries
// composite FKs to projects(id, org_id) and companies(id, org_id), so a link can
// never straddle orgs; the read below is withOrg-scoped so nothing foreign shows.

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

// developer, lender, site_host, agency, advisor, … (schema §3.7).
const roleOptions = [
  { value: "developer", label: "Developer" },
  { value: "lender", label: "Lender" },
  { value: "site_host", label: "Site host" },
  { value: "agency", label: "Agency" },
  { value: "advisor", label: "Advisor" },
];

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const data = await withOrg(ctx.orgId, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      include: {
        projectLinks: {
          include: { company: { select: { name: true, status: true } } },
          orderBy: { role: "asc" },
        },
      },
    });
    if (!project) return null;
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { project, companies };
  });

  if (data == null) notFound();
  const { project, companies } = data;

  const linkedIds = new Set(project.projectLinks.map((l) => l.companyId));
  const linkable = companies.filter((c) => !linkedIds.has(c.id));

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
        <dl className="grid grid-cols-2 gap-4 p-4 text-xs">
          <div>
            <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              Value
            </dt>
            <dd className="text-ink">
              {project.value == null ? "—" : currency.format(Number(project.value))}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              Target date
            </dt>
            <dd className="text-ink">
              {project.targetDate == null ? "—" : dateFmt.format(project.targetDate)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Participants" />
        {project.projectLinks.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">No companies linked yet.</p>
        ) : (
          <Table
            head={
              <>
                <Th>Company</Th>
                <Th>Role</Th>
                <Th>Status</Th>
              </>
            }
          >
            {project.projectLinks.map((l) => (
              <Tr key={l.companyId}>
                <Td className="font-medium">{l.company.name}</Td>
                <Td className="capitalize">{l.role.replace(/_/g, " ")}</Td>
                <Td>
                  <StatusBadge status={l.company.status} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Link a company" />
        {companies.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            Add a{" "}
            <Link href="/dashboard/companies" className="text-gold underline">
              company
            </Link>{" "}
            first.
          </p>
        ) : linkable.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            Every company is already linked to this project.
          </p>
        ) : (
          <form action={linkCompany} className="grid grid-cols-2 gap-4 p-4">
            <input type="hidden" name="projectId" value={project.id} />
            <SelectField name="companyId" label="Company" defaultValue="" required>
              <option value="" disabled>
                Select a company…
              </option>
              {linkable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField name="role" label="Role" defaultValue="" required>
              <option value="" disabled>
                Select a role…
              </option>
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Link company
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
