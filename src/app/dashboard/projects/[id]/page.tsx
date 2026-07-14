import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { PROJECT_STAGES, TERMINAL_STAGES } from "@/lib/project-stages";
import { buildStageTimeline } from "@/lib/stage-history";
import { openRoles } from "@/lib/disciplines";
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

import { linkCompany, updateStage } from "../actions";
import { OpenRoles } from "./_open-roles";

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

// Stage-history dates are stored as UTC "YYYY-MM-DD"; pin formatting to UTC so the
// rendered day can't drift by the server's timezone (and can't mismatch on hydrate).
const stageDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
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

  // Stage history reads the trail updateStage appends to; newest-first for display.
  const timeline = buildStageTimeline(project.stageHistory);

  // Open roles = disciplines not yet staffed on the team. Only meaningful while the
  // project is live — a completed / on-hold project isn't hiring.
  const isActive = !TERMINAL_STAGES.includes(project.stage);
  const unfilledRoles = openRoles(project.projectLinks.map((l) => l.role));

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Type", value: project.type },
    { label: "County", value: project.county },
    {
      label: "Units / keys",
      value: project.units == null ? null : String(project.units),
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
    { label: "Prospect lead", value: project.prospectLead },
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

      {isActive && unfilledRoles.length > 0 ? (
        <OpenRoles projectId={project.id} roles={unfilledRoles} />
      ) : null}

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
