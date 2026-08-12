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
import { NETWORK_STATUSES } from "@/lib/company-statuses";
import { openRoles } from "@/lib/disciplines";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import { loadNewIntroCandidates } from "@/lib/intro-discovery-load";
import { introProfileStrength } from "@/lib/intro-profile-strength";
import { isProactiveCacheFresh } from "@/lib/proactive-cache";
import type { ProactivePairing } from "@/lib/intro-engine";
import {
  INTRO_CONNECTION_TYPES,
  conversionRate,
  daysInStage,
  filterByStage,
  isIntroStale,
  pipelineFunnel,
  stageChips,
  type FunnelCell,
} from "@/lib/intro-pipeline";
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
  Textarea,
  Th,
  Tr,
} from "@/components/ui";

import { createIntroduction, updateIntroduction } from "./actions";
import { confirmIntroAdvance } from "../companies/[id]/actions";
import { IntroEmailDraft } from "./_intro-email";
import {
  IntroEngine,
  UrgentSignalsPanel,
  type ProactiveCacheSnapshot,
} from "./_engine";

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

// Members / partners / prospects are the pool the "For a Member" mode offers —
// the in-network vocabulary plus prospects (worth introducing before they join).
const ENGINE_STATUSES = [...NETWORK_STATUSES, "prospect"];

// Pre-intro states seed the create form; the full vocabulary drives the per-row
// advance control below.
const createStatusOptions = INTRO_STAGES;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// The proactive intro scan (scanNetworkIntros) runs an AI pass over the whole
// network; give its server action headroom past Vercel's short default so it can
// finish instead of timing out.
export const maxDuration = 60;

export default async function IntroductionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const rawStage = one(sp.stage);
  const stageFilter = INTRO_STAGES.some((s) => s.value === rawStage) ? rawStage : "";
  // Draft-email prefill from a ledger row (item 21): the two parties' contact ids.
  // Validated against the loaded contact pool below before they seed the form.
  const rawDraftA = one(sp.draftA);
  const rawDraftB = one(sp.draftB);
  // Commitment cross-links (Commitments item 6): jump here prefilled to act on an
  // outstanding follow-up. `member` seeds the engine's member mode + auto-runs;
  // `logA` / `logText` seed Party A + the headline on the log form. All validated
  // against the loaded pools below.
  const rawMember = one(sp.member);
  const rawLogA = one(sp.logA);
  const rawLogText = one(sp.logText);

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const {
    contacts,
    companies,
    projects,
    introductions,
    pendingIntros,
    newIntroCandidates,
    proactiveCache,
  } = await withOrg(ctx.orgId, async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, company: { select: { name: true } } },
      });
      // Only the engine pool (members / partners / prospects). Alongside the label
      // fields we pull the signals the profile-strength nudge reads (item 19):
      // needs, offers, industry, and whether any active work / primary contact exist.
      const companies = await tx.company.findMany({
        where: { status: { in: ENGINE_STATUSES } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          canOffer: true,
          lookingFor: true,
          industry: true,
          projectLinks: { select: { role: true }, take: 1 },
          contacts: { where: { isPrimary: true }, select: { id: true }, take: 1 },
        },
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
      // Brand-new intro opportunities: recent meetings where two member companies
      // co-attended but no introduction has ever been logged between them.
      const newIntroCandidates = await loadNewIntroCandidates(tx);
      // Last members-scope proactive scan (item 13) — feeds the Urgent Signals
      // panel instantly; the panel itself decides whether to re-scan once it's stale.
      const proactiveCache = await tx.proactiveScanCache.findUnique({
        where: { orgId_scope: { orgId: ctx.orgId, scope: "members" } },
        select: {
          pairings: true,
          meetingIntelligenceActive: true,
          generatedAt: true,
        },
      });
      return {
        contacts,
        companies,
        projects,
        introductions,
        pendingIntros,
        newIntroCandidates,
        proactiveCache,
      };
    });

  const valueCreated = introductions.filter(
    (i) => i.status === "value_created",
  ).length;
  const inFlight = introductions.filter(
    (i) =>
      introStageRank(i.status) >= introStageRank("made") &&
      !TERMINAL_INTRO_STAGES.includes(i.status),
  ).length;

  // Pipeline shaping (S6a): funnel counts + conversion rate over the whole ledger,
  // the stage-filter chips (empty stages hidden), and the rows for the selected
  // stage. `now` anchors the >30-day stale flag on each visible row.
  const now = new Date();
  const funnel = pipelineFunnel(introductions);
  const convRate = conversionRate(introductions);
  const chips = stageChips(introductions);
  const ledger = filterByStage(introductions, stageFilter);

  // Member-mode pool and Project-Catalyst pool (only projects with open roles).
  // Each member carries its profile-strength so the client can nudge for missing
  // signals the moment a focus is picked (item 19).
  const engineMembers = companies.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    strength: introProfileStrength({
      canOffer: (c.canOffer ?? "").trim() !== "",
      lookingFor: (c.lookingFor ?? "").trim() !== "",
      hasProjects: c.projectLinks.length > 0,
      hasIndustry: (c.industry ?? "").trim() !== "",
      hasPrimaryContact: c.contacts.length > 0,
    }),
  }));
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

  // Urgent Signals seed (item 13): the cached members-scope scan, if any. The
  // pairings were written by our own scanNetworkIntros and are re-validated by the
  // panel's parser on any rescan, so reading them back as ProactivePairing[] is safe.
  const proactiveSnapshot: ProactiveCacheSnapshot | null = proactiveCache
    ? {
        pairings: proactiveCache.pairings as unknown as ProactivePairing[],
        generatedAt: proactiveCache.generatedAt.toISOString(),
        meetingIntelligenceActive: proactiveCache.meetingIntelligenceActive,
      }
    : null;
  const proactiveFresh = isProactiveCacheFresh(proactiveCache?.generatedAt);

  // Only honour a prefill whose contacts still exist in the pool (a deleted party
  // or a forged id falls back to the placeholder). Distinct ids only.
  const hasContact = (id: string) => id !== "" && contacts.some((c) => c.id === id);
  const prefillA = hasContact(rawDraftA) ? rawDraftA : "";
  const prefillB =
    hasContact(rawDraftB) && rawDraftB !== prefillA ? rawDraftB : "";

  // Commitment cross-link prefills, validated against the same pools the forms
  // render from (a stale or forged id simply falls back to no prefill).
  const initialMemberId = engineMembers.some((m) => m.id === rawMember)
    ? rawMember
    : "";
  const logPartyA = hasContact(rawLogA) ? rawLogA : "";
  const logHeadline = logPartyA ? rawLogText.slice(0, 200) : "";

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

      {/* Brand-new intro discovery — recent meetings put two member companies in
          the same room with no introduction on record. Log one in a click; the
          pair then drops off (a logged intro suppresses it). */}
      {newIntroCandidates.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-md border border-gold-line bg-surface shadow-card">
          <div className="border-b border-line bg-gold-bg/40 px-4 py-2.5">
            <span className="text-[10px] font-medium tracking-[0.07em] text-gold-ink uppercase">
              New intro opportunities
            </span>
            <span className="ml-2 text-[10px] text-gold-ink/70">
              {newIntroCandidates.length} from recent meetings
            </span>
          </div>
          <div className="divide-y divide-line">
            {newIntroCandidates.map((c) => (
              <div
                key={`${c.companyAId}:${c.companyBId}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] text-ink">
                    {c.contactAName}{" "}
                    <span className="text-ink-3">({c.companyAName})</span>{" "}
                    <span className="text-ink-3">&#8596;</span> {c.contactBName}{" "}
                    <span className="text-ink-3">({c.companyBName})</span>
                  </div>
                  <div className="truncate text-[10px] text-ink-3">
                    Met at {c.meetingTitle} &middot; {relFmt.format(c.meetingDate)}
                  </div>
                </div>
                <form action={createIntroduction} className="flex-shrink-0">
                  <input
                    type="hidden"
                    name="partyAContactId"
                    value={c.contactAId}
                  />
                  <input
                    type="hidden"
                    name="partyBContactId"
                    value={c.contactBId}
                  />
                  <input type="hidden" name="status" value="suggested" />
                  <input
                    type="hidden"
                    name="headline"
                    value={`Met at ${c.meetingTitle}`}
                  />
                  <Button type="submit" variant="primary">
                    Log intro
                  </Button>
                </form>
              </div>
            ))}
          </div>
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

      {/* Situation Room (item 13): the standing proactive briefing, auto-loaded
          from the org cache and rescanned on mount only when stale. */}
      <div className="mb-4">
        <UrgentSignalsPanel
          initial={proactiveSnapshot}
          fresh={proactiveFresh}
          hostName={ctx.userName}
        />
      </div>

      {/* The three matching modes over the network's own reasoning. */}
      <div id="engine" className="scroll-mt-4">
        <IntroEngine
          members={engineMembers}
          projects={engineProjects}
          hostName={ctx.userName}
          initialMemberId={initialMemberId}
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
        <>
          <div id="draft-email" className="scroll-mt-4">
            <IntroEmailDraft
              key={`${prefillA}:${prefillB}`}
              contacts={contacts.map((c) => ({
                id: c.id,
                name: c.name,
                org: c.company.name,
              }))}
              prefillA={prefillA}
              prefillB={prefillB}
            />
          </div>
          <div id="log-intro" className="scroll-mt-4">
            <Card>
              <CardHeader title="Log an introduction" />
              <form
                key={`${logPartyA}:${logHeadline}`}
                action={createIntroduction}
                className="grid grid-cols-2 gap-4 p-4"
              >
                <SelectField
                  name="partyAContactId"
                  label="Party A"
                  defaultValue={logPartyA}
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
                <SelectField
                  name="connectionType"
                  label="Connection type (optional)"
                  defaultValue=""
                >
                  <option value="">Unspecified</option>
                  {INTRO_CONNECTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </SelectField>
                <Field name="madeOn" label="Made on (optional)" type="date" />
                <div className="col-span-2">
                  <Field
                    name="headline"
                    label="Headline (optional)"
                    placeholder="e.g. James needs IDA support — Dan is the right connection"
                    maxLength={200}
                    defaultValue={logHeadline}
                  />
                </div>
                <div className="col-span-2">
                  <Textarea
                    name="notes"
                    label="Notes (optional)"
                    maxLength={1000}
                    rows={2}
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  <Button type="submit" variant="primary">
                    Record introduction
                  </Button>
                </div>
              </form>
            </Card>
          </div>
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
          <>
            <PipelineBar funnel={funnel} convRate={convRate} />
            <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
              {chips.map((chip) => {
                const on = stageFilter === chip.value;
                return (
                  <Link
                    key={chip.value || "all"}
                    href={
                      chip.value === ""
                        ? "/dashboard/introductions"
                        : `/dashboard/introductions?stage=${chip.value}`
                    }
                    className={`rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${
                      on
                        ? "border-gold-line bg-gold-bg text-gold-ink"
                        : "border-line bg-surface text-ink-2 hover:border-gold-line hover:text-gold"
                    }`}
                  >
                    {chip.label} · {chip.count}
                  </Link>
                );
              })}
            </div>
            {ledger.length === 0 ? (
              <p className="px-4 py-6 text-xs text-ink-3">
                No introductions in this stage.
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
                {ledger.map((i) => {
                  const stale = isIntroStale(i.status, i.updatedAt, now);
                  // Prefill the draft-email form with this row's parties, keeping
                  // the current stage filter and jumping to the form (item 21).
                  const draftParams = new URLSearchParams();
                  if (stageFilter) draftParams.set("stage", stageFilter);
                  draftParams.set("draftA", i.partyAContactId);
                  draftParams.set("draftB", i.partyBContactId);
                  const draftHref = `/dashboard/introductions?${draftParams.toString()}#draft-email`;
                  return (
                    <Tr key={i.id}>
                      <Td>
                        <div className="font-medium text-ink">
                          {i.partyA.name}
                          <span className="text-ink-3">
                            {" "}
                            · {i.partyA.company.name}
                          </span>
                        </div>
                        <div className="font-medium text-ink">
                          {i.partyB.name}
                          <span className="text-ink-3">
                            {" "}
                            · {i.partyB.company.name}
                          </span>
                        </div>
                        {i.connectionType ? (
                          <div className="mt-1 text-[9.5px] tracking-[0.06em] text-ink-3 uppercase">
                            {i.connectionType}
                          </div>
                        ) : null}
                        {i.headline ? (
                          <div className="mt-1 text-[11px] text-ink-2">
                            {i.headline}
                          </div>
                        ) : null}
                        {i.notes ? (
                          <div className="mt-1 text-[10px] text-ink-3">
                            {i.notes}
                          </div>
                        ) : null}
                        {i.outcome ? (
                          <div className="mt-1 text-[10px] text-ink-3 italic">
                            {i.outcome}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <StatusBadge status={i.status} />
                        {stale ? (
                          <div className="mt-1 text-[9.5px] font-medium text-amber-ink">
                            Stalled · {daysInStage(i.updatedAt, now)}d in stage
                          </div>
                        ) : null}
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
                        <Link
                          href={draftHref}
                          className="mt-1.5 inline-block text-[10.5px] font-medium text-teal-ink hover:underline"
                        >
                          Draft email
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// Pipeline funnel: per-stage counts across the made-onward lifecycle plus the
// conversion rate (share reaching value_created). Read-only summary above the
// stage-filter chips (parity: Coterie.html:11831).
function PipelineBar({
  funnel,
  convRate,
}: {
  funnel: FunnelCell[];
  convRate: number;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-px border-b border-line bg-line">
      {funnel.map((cell) => (
        <div
          key={cell.value}
          className="min-w-[84px] flex-1 bg-surface px-3 py-2 text-center"
        >
          <div className="font-serif text-[16px] text-ink">{cell.count}</div>
          <div className="mt-0.5 text-[9px] font-medium tracking-[0.06em] text-ink-3 uppercase">
            {cell.label}
          </div>
        </div>
      ))}
      <div className="min-w-[84px] flex-1 bg-surface px-3 py-2 text-center">
        <div className="font-serif text-[16px] text-teal-ink">{convRate}%</div>
        <div className="mt-0.5 text-[9px] font-medium tracking-[0.06em] text-ink-3 uppercase">
          Conversion
        </div>
      </div>
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
