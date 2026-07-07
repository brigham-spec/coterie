import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  BOARD_STAGES,
  PROJECT_STAGES,
  stageRank,
} from "@/lib/project-stages";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";

import { createProject } from "./actions";

// Projects — the pipeline board (build item 4, rebuilt as a kanban in slice
// 11.3). Stage is the canonical vocabulary (@/lib/project-stages); the board
// column per stage plus a Completed section mirror the prototype's funnel. Two
// views (board / list) are selected by ?view= so the choice is server-rendered
// and shareable. One withOrg pass loads every project with its participant
// companies; RLS scopes it to this tenant.

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

// Column-header accent per stage tone → literal classes (Tailwind JIT).
const stageHeadTone: Record<string, string> = {
  slate: "text-slate-ink",
  purple: "text-purple-ink",
  amber: "text-amber-ink",
  gold: "text-gold-ink",
  teal: "text-teal-ink",
  red: "text-red-ink",
};

type ProjectRow = Awaited<ReturnType<typeof loadProjects>>[number];

function loadProjects(orgId: string) {
  return withOrg(orgId, (tx) =>
    tx.project.findMany({
      orderBy: { name: "asc" },
      include: {
        projectLinks: {
          include: { company: { select: { name: true } } },
        },
      },
    }),
  );
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const view =
    (typeof sp.view === "string" ? sp.view : "") === "list" ? "list" : "board";

  const projects = await loadProjects(ctx.orgId);

  const totalValue = projects.reduce((t, p) => t + Number(p.value ?? 0), 0);
  const totalUnits = projects.reduce((t, p) => t + (p.units ?? 0), 0);
  const active = projects.filter(
    (p) => p.stage !== "completed" && p.stage !== "on_hold",
  ).length;
  const underConstruction = projects.filter(
    (p) => p.stage === "under_construction",
  ).length;

  const byStage = new Map<string, ProjectRow[]>();
  for (const p of projects) {
    const list = byStage.get(p.stage) ?? [];
    list.push(p);
    byStage.set(p.stage, list);
  }
  const completed = byStage.get("completed") ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6">
        <PageTitle
          title="Projects"
          subtitle={`${projects.length} in ${ctx.orgName}'s pipeline`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label="Pipeline value"
          value={totalValue > 0 ? currency.format(totalValue) : "TBD"}
        />
        <Metric label="Active projects" value={String(active)} />
        <Metric label="Under construction" value={String(underConstruction)} />
        <Metric
          label="Units / keys"
          value={totalUnits > 0 ? String(totalUnits) : "—"}
        />
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="flex rounded-sm border border-line-2 bg-surface p-0.5 text-[11px]">
          <ViewTab view={view} target="board" label="Board" />
          <ViewTab view={view} target="list" label="List" />
        </div>
      </div>

      <Card>
        <CardHeader title="Add project" />
        <details className="group">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs text-ink-3 hover:text-ink">
            <span className="group-open:hidden">+ Add a project</span>
            <span className="hidden group-open:inline">Cancel</span>
          </summary>
          <form
            action={createProject}
            className="grid grid-cols-2 gap-4 border-t border-line p-4"
          >
            <Field
              name="name"
              label="Project name"
              placeholder="Riverfront redevelopment"
              required
              className="col-span-2"
            />
            <SelectField name="stage" label="Stage" defaultValue="concept">
              {PROJECT_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <Field name="type" label="Type" placeholder="Hospitality" />
            <Field name="county" label="County" placeholder="Dutchess" />
            <Field
              name="units"
              label="Units / keys"
              inputMode="numeric"
              placeholder="0"
            />
            <Field
              name="value"
              label="Value (USD)"
              placeholder="0"
              inputMode="decimal"
            />
            <Field name="targetDate" label="Target date" type="date" />
            <Field
              name="description"
              label="Description"
              placeholder="Short summary"
              className="col-span-2"
            />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Add project
              </Button>
            </div>
          </form>
        </details>
      </Card>

      {projects.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-xs text-ink-3">
            No projects yet. Add one above.
          </p>
        </Card>
      ) : view === "board" ? (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BOARD_STAGES.map((stage) => {
              const items = byStage.get(stage.value) ?? [];
              return (
                <div key={stage.value} className="w-[210px] shrink-0">
                  <div className="mb-2 flex items-center justify-between border-b-2 border-line pb-1.5">
                    <span
                      className={cn(
                        "text-[9px] font-semibold tracking-[0.08em] uppercase",
                        stageHeadTone[stage.tone],
                      )}
                    >
                      {stage.label}
                    </span>
                    <span className="text-[10px] text-ink-3">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.length === 0 ? (
                      <p className="px-1 text-[10px] text-ink-3 italic opacity-60">
                        —
                      </p>
                    ) : (
                      items.map((p) => <ProjectCard key={p.id} project={p} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {completed.length > 0 ? (
            <Card className="mt-4">
              <CardHeader title={`Completed (${completed.length})`} />
              <ul className="divide-y divide-line">
                {completed.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-surface-2"
                    >
                      <span className="font-medium text-ink">{p.name}</span>
                      <span className="text-ink-3">{p.county ?? ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardHeader title="Pipeline" />
          <Table
            head={
              <>
                <Th>Project</Th>
                <Th>Stage</Th>
                <Th>Type</Th>
                <Th>Participants</Th>
                <Th>Value</Th>
                <Th>Target date</Th>
              </>
            }
          >
            {[...projects]
              .sort((a, b) => stageRank(a.stage) - stageRank(b.stage))
              .map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="hover:text-gold hover:underline"
                    >
                      {p.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={p.stage} />
                  </Td>
                  <Td>{p.type ?? "—"}</Td>
                  <Td>{p.projectLinks.length}</Td>
                  <Td>{p.value == null ? "—" : currency.format(Number(p.value))}</Td>
                  <Td>{p.targetDate == null ? "—" : dateFmt.format(p.targetDate)}</Td>
                </Tr>
              ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-card">
      <div className="font-serif text-[18px] text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
    </div>
  );
}

function ViewTab({
  view,
  target,
  label,
}: {
  view: string;
  target: string;
  label: string;
}) {
  const active = view === target;
  return (
    <Link
      href={
        target === "board"
          ? "/dashboard/projects"
          : `/dashboard/projects?view=${target}`
      }
      className={cn(
        "rounded-sm px-2.5 py-1 font-medium transition-colors",
        active ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const companies = project.projectLinks.map((l) => l.company.name);
  const value =
    project.value == null ? null : currency.format(Number(project.value));
  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className="block rounded-md border border-line bg-surface p-2.5 shadow-card transition-shadow hover:shadow-float"
    >
      <div className="text-[12px] font-medium text-ink">{project.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-3">
        {project.type ? (
          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5">
            {project.type}
          </span>
        ) : null}
        {value ? <span className="font-medium text-teal-ink">{value}</span> : null}
        {project.units ? <span>{project.units} keys</span> : null}
        {project.county ? <span>{project.county}</span> : null}
      </div>
      {project.prospectLead ? (
        <div className="mt-1 truncate text-[9.5px] text-ink-3">
          {project.prospectLead}
        </div>
      ) : null}
      {companies.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {companies.slice(0, 3).map((name) => (
            <span
              key={name}
              className="rounded-full bg-gold-bg px-1.5 py-0.5 text-[9px] text-gold-ink"
            >
              {name}
            </span>
          ))}
          {companies.length > 3 ? (
            <span className="text-[9px] text-ink-3">+{companies.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
