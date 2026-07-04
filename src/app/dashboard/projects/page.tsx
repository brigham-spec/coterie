import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
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
} from "@/components/ui";

import { createProject } from "./actions";

// Projects — multi-party initiatives (build item 4). Create/list here; company
// participants are managed on each project's detail page. Read through withOrg
// so RLS scopes the list to this tenant.

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

// Evolvable vocabulary (status is a field, not a table) — see schema §3.6.
const stageOptions = [
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default async function ProjectsPage() {
  const ctx = await requireOrgContext();

  const projects = await withOrg(ctx.orgId, (tx) =>
    tx.project.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { projectLinks: true } } },
    }),
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Projects"
          subtitle={`${projects.length} in ${ctx.orgName}'s pipeline`}
        />
      </div>

      <Card>
        <CardHeader title="Add project" />
        <form action={createProject} className="grid grid-cols-2 gap-4 p-4">
          <Field
            name="name"
            label="Project name"
            placeholder="Riverfront redevelopment"
            required
            className="col-span-2"
          />
          <SelectField name="stage" label="Stage" defaultValue="open">
            {stageOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
          <Field name="value" label="Value (USD)" placeholder="0" inputMode="decimal" />
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
      </Card>

      <Card>
        <CardHeader title="Pipeline" />
        {projects.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No projects yet. Add one above.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Project</Th>
                <Th>Stage</Th>
                <Th>Participants</Th>
                <Th>Value</Th>
                <Th>Target date</Th>
              </>
            }
          >
            {projects.map((p) => (
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
                <Td>{p._count.projectLinks}</Td>
                <Td>{p.value == null ? "—" : currency.format(Number(p.value))}</Td>
                <Td>{p.targetDate == null ? "—" : dateFmt.format(p.targetDate)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
