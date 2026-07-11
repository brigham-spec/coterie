import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  INTRO_STAGES,
  TERMINAL_INTRO_STAGES,
  getIntroStageDef,
  introStageRank,
} from "@/lib/intro-stages";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import { openRoles } from "@/lib/disciplines";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
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
import { confirmIntroAdvance } from "../companies/[id]/actions";
import { IntroEmailDraft } from "./_intro-email";
import { IntroEngine } from "./_engine";

// Introductions — the product's core verb, and the prototype's flagship module
// (Coterie.html:14566 "Introduction Intelligence"). This page is the unified
// Introduction Engine: proactive signals from meeting evidence at the top, then
// the three matching modes (For a Member / Project Catalyst / Network Scan) over
// the network's own reasoning, then the manual tools (draft email, log an intro)
// and the lifecycle ledger. Every read is scoped by RLS through one withOrg pass
// so nothing foreign appears; the AI modes each run in their own on-demand server
// action, so this page stays a single data round-trip.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const relFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

// Members / partners / prospects are the pool the "For a Member" mode offers.
const ENGINE_STATUSES = new Set(["member", "strategic_partner", "prospect"]);

// Pre-intro states seed the create form; the full vocabulary drives the per-row
// advance control below.
const createStatusOptions = INTRO_STAGES;

export default async function IntroductionsPage() {
  const ctx = await requireOrgContext();

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const { contacts, companies, projects, introductions, pendingIntros } =
    await withOrg(ctx.orgId, async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      });
      const companies = await tx.company.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true },
      });
      const projects = await tx.project.findMany({
        where: { stage: { notIn: [...TERMINAL_STAGES] } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          stage: true,
          county: true,
          projectLinks: { select: { role: true } },
        },
      });
      const introductions = await tx.introduction.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          partyA: { select: { name: true, company: { select: { name: true } } } },
          partyB: { select: { name: true, company: { select: { name: true } } } },
          project: { select: { name: true } },
        },
      });
      const pendingIntros = await loadPendingIntroDetections(tx);
      return { contacts, companies, projects, introductions, pendingIntros };
    });

  const valueCreated = introductions.filter(
    (i) => i.status === "value_created",
  ).length;
  const inFlight = introductions.filter(
    (i) =>
      introStageRank(i.status) >= introStageRank("made") &&
      !TERMINAL_INTRO_STAGES.includes(i.status),
  ).length;

  // Member-mode pool and Project-Catalyst pool (only projects with open roles).
  const engineMembers = companies.filter((c) => ENGINE_STATUSES.has(c.status));
  const engineProjects = projects
    .map((p) => ({
      id: p.id,
      name: p.name,
      stage: p.stage,
      county: p.county,
      openRoles: openRoles(p.projectLinks.map((l) => l.role)).map((d) => ({
        value: d.value,
        label: d.label,
      })),
    }))
    .filter((p) => p.openRoles.length > 0);

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

      {/* Urgent signals — meetings evidence an in-flight intro advanced; confirm
          before the stage moves. This is the engine's proactive layer. */}
      {pendingIntros.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-md border border-teal-line bg-surface shadow-card">
          <div className="border-b border-line bg-teal-bg/40 px-4 py-2.5">
            <span className="text-[10px] font-medium tracking-[0.07em] text-teal-ink uppercase">
              Detected from meetings
            </span>
            <span className="ml-2 text-[10px] text-teal-ink/70">
              {pendingIntros.length} awaiting confirmation
            </span>
          </div>
          <div className="divide-y divide-line">
            {pendingIntros.map((d) => (
              <div
                key={d.introId}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] text-ink">
                    {d.partyALabel} <span className="text-ink-3">&#8596;</span>{" "}
                    {d.partyBLabel}
                    <span className="ml-1.5 text-[10px] text-teal-ink">
                      {getIntroStageDef(d.currentStage).label} &#8594;{" "}
                      {getIntroStageDef(d.suggestedStage).label}
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-ink-3">
                    {d.meetingTitle} &middot; {relFmt.format(d.meetingDate)}
                  </div>
                </div>
                <form action={confirmIntroAdvance} className="flex-shrink-0">
                  <input type="hidden" name="introId" value={d.introId} />
                  <input type="hidden" name="status" value={d.suggestedStage} />
                  <Button type="submit" variant="primary">
                    Confirm
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* The three matching modes over the network's own reasoning. */}
      <IntroEngine members={engineMembers} projects={engineProjects} />

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
        <>
          <IntroEmailDraft
            contacts={contacts.map((c) => ({
              id: c.id,
              name: c.name,
              org: c.company.name,
            }))}
          />
          <Card>
            <CardHeader title="Log an introduction" />
            <form
              action={createIntroduction}
              className="grid grid-cols-2 gap-4 p-4"
            >
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
              <SelectField
                name="projectId"
                label="Project (optional)"
                defaultValue=""
              >
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
        </>
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
