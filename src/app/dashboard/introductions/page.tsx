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

import { createIntroduction } from "./actions";

// Introductions — who was connected to whom, toward what (build item 4). Party A
// and B are contacts; an intro may advance a project. Contacts, projects, and the
// intro list are all read through withOrg in one tx, so nothing foreign appears.
// An intro needs two distinct contacts, so we require at least two before showing
// the form.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// Evolvable vocabulary (status is a field, not a table) — see schema §3.8.
const statusOptions = [
  { value: "suggested", label: "Suggested" },
  { value: "drafted", label: "Drafted" },
  { value: "made", label: "Made" },
  { value: "meeting_held", label: "Meeting held" },
  { value: "closed", label: "Closed" },
];

export default async function IntroductionsPage() {
  const ctx = await requireOrgContext();

  const [contacts, projects, introductions] = await withOrg(ctx.orgId, (tx) =>
    Promise.all([
      tx.contact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      }),
      tx.project.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      tx.introduction.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          partyA: { select: { name: true } },
          partyB: { select: { name: true } },
          project: { select: { name: true } },
        },
      }),
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Introductions"
          subtitle={`${introductions.length} made across ${ctx.orgName}'s network`}
        />
      </div>

      {contacts.length < 2 ? (
        <Card>
          <CardHeader title="Make an introduction" />
          <p className="px-4 py-6 text-xs text-ink-3">
            Add at least two{" "}
            <Link href="/dashboard/contacts" className="text-gold underline">
              contacts
            </Link>{" "}
            to make an introduction.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Make an introduction" />
          <form action={createIntroduction} className="grid grid-cols-2 gap-4 p-4">
            <SelectField
              name="partyAContactId"
              label="Party A"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select a contact…
              </option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.company.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              name="partyBContactId"
              label="Party B"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select a contact…
              </option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.company.name}
                </option>
              ))}
            </SelectField>
            <SelectField name="status" label="Status" defaultValue="suggested">
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <SelectField name="projectId" label="Project (optional)" defaultValue="">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <Field name="madeOn" label="Made on (optional)" type="date" />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Record introduction
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Ledger" />
        {introductions.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No introductions yet.
            {contacts.length >= 2 ? " Record one above." : ""}
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Party A</Th>
                <Th>Party B</Th>
                <Th>Status</Th>
                <Th>Source</Th>
                <Th>Project</Th>
                <Th>Made on</Th>
              </>
            }
          >
            {introductions.map((i) => (
              <Tr key={i.id}>
                <Td className="font-medium">{i.partyA.name}</Td>
                <Td className="font-medium">{i.partyB.name}</Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td className="capitalize">{i.source.replace(/_/g, " ")}</Td>
                <Td>{i.project?.name ?? "—"}</Td>
                <Td>{i.madeOn == null ? "—" : dateFmt.format(i.madeOn)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
