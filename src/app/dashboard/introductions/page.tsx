import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  INTRO_STAGES,
  TERMINAL_INTRO_STAGES,
  introStageRank,
} from "@/lib/intro-stages";
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

import { createIntroduction, updateIntroduction } from "./actions";

// Introductions — who was connected to whom, toward what (build item 4; ledger
// lifecycle rebuilt in slice 11.4a). Party A and B are contacts; an intro may
// advance a project and progresses along a canonical lifecycle
// (@/lib/intro-stages): suggested → drafted → made → connected → meeting_set →
// collaborating → value_created / dormant. Contacts, projects, and the intro list
// are all read through withOrg in one tx, so nothing foreign appears. An intro
// needs two distinct contacts, so we require at least two before showing the form.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// Pre-intro states seed the create form; the full vocabulary drives the per-row
// advance control below.
const createStatusOptions = INTRO_STAGES;

export default async function IntroductionsPage() {
  const ctx = await requireOrgContext();

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const { contacts, projects, introductions } = await withOrg(
    ctx.orgId,
    async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      });
      const projects = await tx.project.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      const introductions = await tx.introduction.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          partyA: { select: { name: true, company: { select: { name: true } } } },
          partyB: { select: { name: true, company: { select: { name: true } } } },
          project: { select: { name: true } },
        },
      });
      return { contacts, projects, introductions };
    },
  );

  const valueCreated = introductions.filter(
    (i) => i.status === "value_created",
  ).length;
  const inFlight = introductions.filter(
    (i) => introStageRank(i.status) >= introStageRank("made") &&
      !TERMINAL_INTRO_STAGES.includes(i.status),
  ).length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Introductions"
          subtitle={`${introductions.length} made across ${ctx.orgName}'s network`}
        />
      </div>

      {introductions.length > 0 ? (
        <div className="mb-4 grid grid-cols-3 gap-4">
          <Metric label="Total intros" value={String(introductions.length)} />
          <Metric label="In flight" value={String(inFlight)} />
          <Metric label="Value created" value={String(valueCreated)} />
        </div>
      ) : null}

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
              {createStatusOptions.map((o) => (
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
                <Th>Parties</Th>
                <Th>Stage</Th>
                <Th>Project</Th>
                <Th>Made on</Th>
                <Th>Advance</Th>
              </>
            }
          >
            {introductions.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <div className="font-medium text-ink">
                    {i.partyA.name}
                    <span className="text-ink-3"> · {i.partyA.company.name}</span>
                  </div>
                  <div className="font-medium text-ink">
                    {i.partyB.name}
                    <span className="text-ink-3"> · {i.partyB.company.name}</span>
                  </div>
                  {i.outcome ? (
                    <div className="mt-1 text-[10px] text-ink-3 italic">
                      {i.outcome}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td>{i.project?.name ?? "—"}</Td>
                <Td>{i.madeOn == null ? "—" : dateFmt.format(i.madeOn)}</Td>
                <Td>
                  <form
                    action={updateIntroduction}
                    className="flex flex-col gap-1.5"
                  >
                    <input type="hidden" name="introId" value={i.id} />
                    <select
                      name="status"
                      defaultValue={i.status}
                      className="w-full rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
                    >
                      {INTRO_STAGES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      name="outcome"
                      defaultValue={i.outcome ?? ""}
                      placeholder="Outcome note…"
                      className="w-full rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
                    />
                    <Button type="submit" className="justify-center">
                      Save
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
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
