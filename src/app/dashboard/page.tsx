import Link from "next/link";
import type { ReactNode } from "react";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { deriveInvoiceBalance, sumPayments } from "@/lib/invoice-status";
import { TERMINAL_STAGES } from "@/lib/project-stages";
import { groupConnections } from "@/lib/new-connections";
import { getIntroStageDef } from "@/lib/intro-stages";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import { buildProposalNudge } from "@/lib/proposal-nudge";
import {
  classifySyncStatus,
  summarizeRecentSync,
  RECENT_SYNC_WINDOW_MS,
  type SyncStatus,
  type RecentSyncSummary,
} from "@/lib/sync-status";
import { buildEnrichmentNudges } from "@/lib/enrichment-nudge";
import { buildReferralLeaderboard } from "@/lib/referral-leaderboard";
import { resolveScope, type DashboardScope } from "@/lib/dashboard-scope";
import { cn, StatusBadge } from "@/components/ui";

import { Greeting } from "./_greeting";
import { DailyFocus } from "./_daily-focus";
import { EnrichmentNudges } from "./_enrichment-nudges";
import { IntroScan } from "./_intro-scan";
import { NewConnections } from "./_new-connections";
import { QuickCapture } from "./_quick-capture";
import { SyncNowButtonCompact } from "./meetings/_sync-now";

// Dashboard overview (slice 11.1) — the operator's morning surface. Six KPI
// pills over three rows of at-a-glance cards: pipeline (projects/events/cold
// members), relationship activity (intros/proposals/quick actions), and a
// revenue snapshot. Everything is read in ONE withOrg pass so RLS scopes it to
// this tenant and there is a single round-trip.
//
// The prototype's AI-driven cards ride on top of this data surface: the proactive
// intro scan (IntroScan) and the Daily Focus briefing (DailyFocus) run their
// Anthropic calls in their own on-demand server actions, so this page stays a
// single data-only round-trip.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const DAY = 86_400_000;

// Cold-contact thresholds mirror the prototype: a Director-tier member goes cold
// faster than an Advisory one.
const COLD_DAYS: Record<string, number> = {
  "Director Level": 30,
  "Advisory Level": 45,
};
const COLD_DEFAULT = 45;

// The proactive intro scan (scanNetworkIntros) runs an AI pass over the whole
// network; give its server action headroom past Vercel's short default so it can
// finish instead of timing out.
export const maxDuration = 60;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const ctx = await requireOrgContext();
  const isAdmin = ctx.role === "admin";
  // Personal-vs-org scoping for the tailored cards. Staff are pinned to "mine";
  // admins default to "mine" and opt into "everyone" via the ?scope param. The
  // clamp lives in resolveScope so a staff user can't widen their view by
  // tampering the URL.
  const scope = resolveScope(isAdmin, (await searchParams).scope);
  const now = new Date();
  // dueOn is a @db.Date at UTC midnight, so these revenue-bucket boundaries are
  // built in the UTC calendar too (review M2); the day-window anchors below are
  // instant deltas against Timestamptz columns and stay wall-clock.
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const startMonthAfter = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1),
  );
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d60 = new Date(now.getTime() - 60 * DAY);

  // A Prisma interactive transaction holds a SINGLE pooled connection, so its
  // reads must run sequentially: issuing them concurrently (Promise.all) makes
  // pg execute overlapping queries on one client, which serializes under
  // contention and can stall the RSC fetch a Link prefetch depends on. RLS
  // forces every tenant read inside this one tx, so we await them in order.
  const {
    companies,
    projects,
    events,
    intros,
    proposals,
    invoices,
    unmatched,
    myMeetingIds,
    pendingIntros,
    firefliesCred,
    recentSyncedMeetings,
  } = await withOrg(ctx.orgId, async (tx) => {
    const companies = await tx.company.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        tier: true,
        industry: true,
        lastContactAt: true,
        website: true,
        lookingFor: true,
        canOffer: true,
        // The assigned staff owner — scopes the "Needs a Call" card/tile to "mine".
        ownerUserId: true,
        // Who referred this company — drives the referral leaderboard tally.
        referredById: true,
        // Presence of a primary contact drives the enrichment nudge — take 1 is
        // enough to know whether the profile has one.
        contacts: {
          where: { isPrimary: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    const projects = await tx.project.findMany({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        stage: true,
        _count: { select: { projectLinks: true } },
      },
    });
    const events = await tx.event.findMany({
      where: {
        date: { gte: startOfToday },
        stage: { notIn: ["completed", "cancelled"] },
      },
      orderBy: { date: "asc" },
      take: 5,
      select: { id: true, name: true, type: true, venue: true, date: true },
    });
    const intros = await tx.introduction.findMany({
      where: scope === "mine" ? { ownerUserId: ctx.userId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        createdAt: true,
        partyA: { select: { company: { select: { name: true } } } },
        partyB: { select: { company: { select: { name: true } } } },
      },
    });
    const proposals = await tx.membershipProposal.findMany({
      where: scope === "mine" ? { ownerUserId: ctx.userId } : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tier: true,
        amount: true,
        status: true,
        sentOn: true,
        lastFollowUpAt: true,
        createdAt: true,
        companyId: true,
        company: { select: { name: true } },
      },
    });
    const invoices = await tx.invoice.findMany({
      select: {
        status: true,
        amount: true,
        dueOn: true,
        companyId: true,
        payments: { select: { amount: true } },
      },
    });
    const unmatched = await tx.unmatchedAttendee.findMany({
      where: { dismissedAt: null },
      orderBy: { seenCount: "desc" },
      select: {
        id: true,
        email: true,
        domain: true,
        inferredName: true,
        inferredOrg: true,
        seenCount: true,
        lastMeetingTitle: true,
        // Which meetings evidenced this stranger — intersected with the user's
        // own meetings to scope New Connections to "mine".
        meetingIds: true,
      },
    });
    // Meetings the current user was on (staff attendance from Fireflies). New
    // Connections is always scoped to the current user's own calls — regardless
    // of the mine/everyone toggle — so each person only reviews strangers they
    // personally met, never the whole tenant's backlog.
    const myMeetingIds = await tx.meetingStaffAttendee.findMany({
      where: { userId: ctx.userId },
      select: { meetingId: true },
    });
    // Fireflies-evidenced intro-stage advances awaiting confirmation.
    const pendingIntros = await loadPendingIntroDetections(tx);
    // Fireflies connection + last-sync clock for the sync-status card. RLS
    // scopes it to this org, so findFirst on provider resolves at most one row.
    const firefliesCred = await tx.integrationCredential.findFirst({
      where: { provider: "fireflies" },
      select: { lastSyncedAt: true },
    });
    // Meetings that landed in the recent window feed the sync bar's meeting
    // count + member pills. Bounded by the recency window, and capped so an
    // unusually heavy sync can't bloat the dashboard read.
    const recentSyncedMeetings = await tx.meeting.findMany({
      where: {
        firefliesId: { not: null },
        createdAt: { gte: new Date(now.getTime() - RECENT_SYNC_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        attendees: {
          select: {
            contact: { select: { company: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    return {
      companies,
      projects,
      events,
      intros,
      proposals,
      invoices,
      unmatched,
      myMeetingIds,
      pendingIntros,
      firefliesCred,
      recentSyncedMeetings,
    };
  });

  const recentPendingIntros = pendingIntros.slice(0, 5);

  // Fireflies sync health for the status bar — connection state + last-sync age.
  const syncStatus = classifySyncStatus(
    firefliesCred != null,
    firefliesCred?.lastSyncedAt ?? null,
    now,
  );
  // Meeting count + which members were touched, for the sync bar's pills.
  const recentSync = summarizeRecentSync(recentSyncedMeetings);

  // Companies narrowed to the current scope: "mine" = this user's owned rows,
  // "everyone" = the whole org. Drives the owner-scoped surfaces below so the
  // enrichment nudge and Members/Prospects tiles match "Needs a Call".
  const scopedCompanies = companies.filter(
    (c) => scope === "everyone" || c.ownerUserId === ctx.userId,
  );

  // Enrichment nudge — in-network members whose network-facing fields are blank.
  const enrichmentNudges = buildEnrichmentNudges(
    scopedCompanies.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      website: c.website,
      lookingFor: c.lookingFor,
      canOffer: c.canOffer,
      hasPrimaryContact: c.contacts.length > 0,
    })),
  );

  // New Connections Detected — cluster unmatched meeting attendees by domain.
  // Always narrowed to strangers seen in the current user's own meetings so each
  // person reviews only the people they personally met on a Fireflies call.
  const mineMeetingSet = new Set(myMeetingIds.map((m) => m.meetingId));
  const scopedUnmatched = unmatched.filter((u) =>
    u.meetingIds.some((id) => mineMeetingSet.has(id)),
  );
  const connectionGroups = groupConnections(scopedUnmatched);
  const companyOptions = companies.map((c) => ({ id: c.id, name: c.name }));

  // Referral Leaderboard — rank in-network referrers by referrals made.
  const referralLeaderboard = buildReferralLeaderboard(companies);

  // ── KPI pill counts ────────────────────────────────────────────────────────
  const memberCount = scopedCompanies.filter(
    (c) => c.status === "member",
  ).length;
  const prospectCount = scopedCompanies.filter(
    (c) => c.status === "prospect",
  ).length;
  const introsThisMonth = intros.filter((i) => i.createdAt >= d30).length;

  const proposalCompanies = new Set(
    proposals.filter((p) => p.createdAt >= d30).map((p) => p.companyId),
  );

  // Open proposals gone quiet for over a week — the follow-up nudge banner.
  const proposalNudge = buildProposalNudge(
    proposals.map((p) => ({
      id: p.id,
      companyName: p.company.name,
      status: p.status,
      sentOn: p.sentOn,
      lastFollowUpAt: p.lastFollowUpAt,
      createdAt: p.createdAt,
    })),
    now,
  );

  // ── Needs a Call — members past their tier's cold threshold ─────────────────
  // In "mine" scope this narrows to members this user owns; "everyone" is org-wide.
  const coldMembers = scopedCompanies
    .filter((c) => c.status === "member")
    .map((c) => {
      const days = c.lastContactAt
        ? Math.floor((now.getTime() - c.lastContactAt.getTime()) / DAY)
        : Infinity;
      return { ...c, days };
    })
    .filter((c) => c.days > (COLD_DAYS[c.tier ?? ""] ?? COLD_DEFAULT))
    .sort((a, b) => b.days - a.days);

  // ── Revenue snapshot — outstanding balances bucketed by due date ────────────
  const buckets = { overdue: money(), thisMonth: money(), nextMonth: money() };
  for (const inv of invoices) {
    const { status, balance } = deriveInvoiceBalance(
      inv.status,
      inv.amount,
      sumPayments(inv.payments),
    );
    if (status === "void" || status === "paid") continue;
    const amt = Number(balance);
    if (amt <= 0) continue;
    if (inv.dueOn < startOfToday) bucket(buckets.overdue, inv.companyId, amt);
    else if (inv.dueOn < startNextMonth)
      bucket(buckets.thisMonth, inv.companyId, amt);
    else if (inv.dueOn < startMonthAfter)
      bucket(buckets.nextMonth, inv.companyId, amt);
  }

  const recentIntros = intros.filter((i) => i.createdAt >= d60).slice(0, 5);
  const showRevenue =
    buckets.overdue.total > 0 ||
    buckets.thisMonth.total > 0 ||
    buckets.nextMonth.total > 0;

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Hero greeting */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <Greeting name={ctx.userName || "there"} />
        {/* Admin-only scope toggle — narrows the tailored cards (Needs a Call,
            Daily Focus) to this user's own work or the whole org. */}
        {isAdmin ? <ScopeToggle scope={scope} /> : null}
      </div>

      {/* Metric strip — the network at a glance */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric n={memberCount} label="Members" href="/dashboard/companies" />
        <Metric n={prospectCount} label="Prospects" href="/dashboard/companies" />
        <Metric n={projects.length} label="Projects" href="/dashboard/projects" />
        <Metric
          n={introsThisMonth}
          label="Intros / mo"
          href="/dashboard/introductions"
        />
        <Metric n={proposalCompanies.size} label="Proposals / mo" />
        <Metric
          n={coldMembers.length}
          label="Need a call"
          href="/dashboard/companies"
        />
      </div>

      {/* Fireflies sync status — connection health + last-sync freshness */}
      <SyncStatusBar status={syncStatus} recentSync={recentSync} now={now} />

      {/* Daily Focus — AI briefing over open commitments + upcoming events,
          across Today / This Week / This Month horizons (on-demand). */}
      <DailyFocus scope={scope} />

      {/* Layer-0 — proactive introduction scanner */}
      <IntroScan />

      {/* Quick capture — turn a plain-English note into a reviewable meeting +
          prospects (cluster E micro AI; nothing is stored until Save). */}
      <QuickCapture />

      {/* Proposal follow-up — open proposals that have gone quiet for over a week */}
      {proposalNudge ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-gold-line border-l-[3px] bg-gold-bg px-4 py-2.5">
          <p className="text-[11.5px] text-gold-ink">
            {proposalNudge.stale.length} proposal
            {proposalNudge.stale.length === 1 ? "" : "s"} need follow-up — oldest
            is {proposalNudge.oldestDays}d without contact
          </p>
          <Link
            href="/dashboard/proposals"
            className="flex-shrink-0 rounded-md border border-gold-line px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap text-gold-ink transition-colors hover:bg-gold-line/20"
          >
            Review Proposals
          </Link>
        </div>
      ) : null}

      {/* Enrichment nudge — members with thin profiles the operator can fill */}
      <EnrichmentNudges nudges={enrichmentNudges} />

      {/* Pending Introductions — meetings evidence an intro advanced; confirm on
          the company profile or the ledger before the stage moves. */}
      {recentPendingIntros.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-md border border-teal-line bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line bg-teal-bg/40 px-4 py-2.5">
            <span className="text-[10px] font-medium tracking-[0.07em] text-teal-ink uppercase">
              Pending Introductions
            </span>
            <Link
              href="/dashboard/introductions"
              className="text-[10px] font-semibold text-teal-ink hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="py-1">
            {recentPendingIntros.map((d) => (
              <RowLink key={d.introId} href="/dashboard/introductions">
                <Dot />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-ink">
                    {d.partyALabel} <span className="text-ink-3">&#8596;</span>{" "}
                    {d.partyBLabel}
                    <span className="ml-1.5 text-[10px] text-teal-ink">
                      &#8594; {getIntroStageDef(d.suggestedStage).label}
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-ink-3">
                    {d.meetingTitle} &middot; {relTime(now, d.meetingDate)}
                  </div>
                </div>
              </RowLink>
            ))}
          </div>
        </div>
      ) : null}

      {/* New Connections Detected — Fireflies attendees not yet in the network */}
      <NewConnections groups={connectionGroups} companies={companyOptions} />

      {/* ROW 3 — Active Projects | Upcoming Events | Needs a Call */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <DashCard title="Active Projects" viewHref="/dashboard/projects">
          {projects.length === 0 ? (
            <Empty>No active projects</Empty>
          ) : (
            projects.slice(0, 5).map((p) => (
              <RowLink key={p.id} href="/dashboard/projects">
                <Dot />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">
                    {p.name}
                  </div>
                  <div className="text-[10px] text-ink-3">
                    {labelize(p.stage)}
                    {p._count.projectLinks > 0
                      ? ` \u00b7 ${p._count.projectLinks} member${p._count.projectLinks === 1 ? "" : "s"}`
                      : ""}
                  </div>
                </div>
              </RowLink>
            ))
          )}
        </DashCard>

        <DashCard title="Upcoming Events">
          {events.length === 0 ? (
            <Empty>No upcoming events</Empty>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2.5 border-b border-line px-4 py-2 last:border-b-0"
              >
                <CalChip date={e.date} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">
                    {e.name}
                  </div>
                  <div className="text-[10px] text-ink-3">
                    {e.venue || labelize(e.type)}
                  </div>
                </div>
              </div>
            ))
          )}
        </DashCard>

        <DashCard title="Needs a Call" viewHref="/dashboard/companies">
          {coldMembers.length === 0 ? (
            <Empty>Everyone is up to date</Empty>
          ) : (
            coldMembers.slice(0, 4).map((m) => (
              <RowLink key={m.id} href={`/dashboard/companies/${m.id}`}>
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold text-ink">
                    {m.name}
                  </div>
                  <div className="truncate text-[9.5px] text-ink-3">
                    {m.industry}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-[10px] font-semibold whitespace-nowrap",
                    m.days > 90 ? "text-red-ink" : "text-gold-ink",
                  )}
                >
                  {m.days === Infinity ? "Never" : `${m.days}d`}
                </div>
              </RowLink>
            ))
          )}
        </DashCard>
      </div>

      {/* ROW 4 — Recent Introductions | Membership Proposals | Quick Actions */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <DashCard title="Recent Introductions" viewHref="/dashboard/introductions">
          {recentIntros.length === 0 ? (
            <Empty>No introductions logged yet</Empty>
          ) : (
            recentIntros.map((i) => (
              <RowLink key={i.id} href="/dashboard/introductions">
                <Dot />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-ink">
                    {i.partyA.company.name}{" "}
                    <span className="text-ink-3">&#8596;</span>{" "}
                    {i.partyB.company.name}
                  </div>
                  <div className="text-[10px] text-ink-3">
                    {relTime(now, i.createdAt)}
                    {i.status !== "made" ? ` \u00b7 ${labelize(i.status)}` : ""}
                  </div>
                </div>
              </RowLink>
            ))
          )}
        </DashCard>

        <DashCard title="Membership Proposals" anchorId="membership-proposals">
          {proposals.length === 0 ? (
            <Empty>No proposals logged yet</Empty>
          ) : (
            proposals.slice(0, 6).map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 border-b border-line px-4 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">
                    {p.company.name}
                  </div>
                  <div className="text-[10px] text-ink-3">
                    {p.tier}
                    {p.amount ? ` \u00b7 ${currency.format(Number(p.amount))}` : ""}
                    {` \u00b7 ${relTime(now, p.createdAt)}`}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))
          )}
        </DashCard>

        <DashCard title="Quick Actions">
          <div className="grid grid-cols-3 gap-px bg-line">
            {QUICK_ACTIONS.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex flex-col items-center justify-center gap-1.5 bg-surface px-2 py-4 text-center transition-colors hover:bg-teal-bg hover:text-teal-ink"
              >
                <span className="text-[15px] leading-none">{a.icon}</span>
                <span className="text-[10px] leading-tight font-medium text-ink-3">
                  {a.label}
                </span>
              </Link>
            ))}
          </div>
        </DashCard>
      </div>

      {/* Referral Leaderboard — who has sent the most referrals into the network */}
      {referralLeaderboard.length > 0 ? (
        <div className="mb-4">
          <DashCard title="Referral Leaderboard" viewHref="/dashboard/companies">
            {referralLeaderboard.slice(0, 6).map((r, i) => (
              <RowLink key={r.id} href={`/dashboard/companies/${r.id}`}>
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gold-bg text-[10px] font-bold text-gold-ink">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">
                    {r.name}
                  </div>
                </div>
                <div className="text-[10px] font-semibold whitespace-nowrap text-gold-ink">
                  {r.count} referral{r.count === 1 ? "" : "s"}
                </div>
              </RowLink>
            ))}
          </DashCard>
        </div>
      ) : null}

      {/* ROW 5 — Revenue snapshot */}
      {showRevenue ? (
        <DashCard title="Revenue" viewHref="/dashboard/invoices">
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            {buckets.overdue.total > 0 ? (
              <RevMetric
                label="Overdue"
                total={buckets.overdue}
                tone="text-red-ink"
              />
            ) : null}
            <RevMetric
              label="Due This Month"
              total={buckets.thisMonth}
              tone="text-teal-ink"
            />
            <RevMetric
              label="Due Next Month"
              total={buckets.nextMonth}
              tone="text-ink-2"
            />
          </div>
        </DashCard>
      ) : null}
    </div>
  );
}

// ── Revenue bucket accumulator ────────────────────────────────────────────────
type Bucket = { total: number; companies: Set<string> };
function money(): Bucket {
  return { total: 0, companies: new Set() };
}
function bucket(b: Bucket, companyId: string, amt: number) {
  b.total += amt;
  b.companies.add(companyId);
}

// ── Small presentational helpers (server-safe) ────────────────────────────────
function labelize(value: string | null): string {
  if (!value) return "";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function relTime(now: Date, then: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

// Admin-only segmented control that carries the ?scope param. Zero-JS: each side
// is a Link, so switching is a plain navigation the server re-resolves through
// resolveScope.
function ScopeToggle({ scope }: { scope: DashboardScope }) {
  const opts: Array<{ key: DashboardScope; label: string }> = [
    { key: "mine", label: "Mine" },
    { key: "everyone", label: "Everyone" },
  ];
  return (
    <div className="flex flex-shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      {opts.map((o) => {
        const active = o.key === scope;
        return (
          <Link
            key={o.key}
            href={o.key === "mine" ? "/dashboard" : `/dashboard?scope=${o.key}`}
            className={cn(
              "px-3 py-1.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-teal-bg text-teal-ink"
                : "text-ink-3 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function Metric({
  n,
  label,
  href,
}: {
  n: number;
  label: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="font-serif text-[30px] leading-none text-ink">{n}</div>
      <div className="mt-2 text-[10px] font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase">
        {label}
      </div>
    </>
  );
  const base =
    "flex flex-col rounded-md border border-line bg-surface px-4 py-3.5 shadow-card";
  return href ? (
    <Link
      href={href}
      className={cn(
        base,
        "transition-all hover:-translate-y-0.5 hover:border-line-2 hover:shadow-float",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

function DashCard({
  title,
  viewHref,
  anchorId,
  children,
}: {
  title: string;
  viewHref?: string;
  anchorId?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={anchorId}
      className="overflow-hidden rounded-md border border-line bg-surface shadow-card scroll-mt-4"
    >
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-3">
        <span className="font-serif text-[14px] leading-none text-ink">
          {title}
        </span>
        {viewHref ? (
          <Link
            href={viewHref}
            className="text-[10px] font-semibold tracking-[0.04em] text-teal-ink uppercase hover:underline"
          >
            View all
          </Link>
        ) : null}
      </div>
      <div className="py-1">{children}</div>
    </div>
  );
}

function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 border-b border-line px-4 py-2 transition-colors last:border-b-0 hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-[11px] text-ink-3 italic">{children}</p>;
}

function Dot() {
  return (
    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 self-start rounded-full bg-gold" />
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-[8px] font-semibold text-ink-2">
      {initials(name)}
    </span>
  );
}

function CalChip({ date }: { date: Date | null }) {
  if (!date) {
    return (
      <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-md bg-surface-3 text-[9px] text-ink-3">
        TBD
      </span>
    );
  }
  const month = date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return (
    <span className="flex h-[34px] w-[34px] flex-shrink-0 flex-col items-center justify-center rounded-md border border-gold-line bg-gold-bg leading-none">
      <span className="text-[8px] font-bold text-gold-ink uppercase">{month}</span>
      <span className="text-[14px] font-bold text-gold-ink">{date.getUTCDate()}</span>
    </span>
  );
}

function RevMetric({
  label,
  total,
  tone,
}: {
  label: string;
  total: Bucket;
  tone: string;
}) {
  const count = total.companies.size;
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3.5 py-2.5">
      <div className="mb-0.5 text-[11px] font-semibold text-ink-3">{label}</div>
      <div className={cn("font-serif text-[20px]", tone)}>
        {currency.format(total.total)}
      </div>
      <div className="text-[10px] text-ink-3">
        {count} member{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// Thin Fireflies sync-status bar (gap-audit cluster B). Mirrors the prototype's
// "last synced …" bar (Coterie.html:3116) in the durable-job model: freshness is
// read from the persisted last-sync clock, and "Sync now" enqueues the job.
function SyncStatusBar({
  status,
  recentSync,
  now,
}: {
  status: SyncStatus;
  recentSync: RecentSyncSummary;
  now: Date;
}) {
  if (status.health === "disconnected") {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-4 py-2">
        <p className="text-[11px] text-ink-3">
          Fireflies is not connected — sync meeting transcripts to surface new
          connections and action items.
        </p>
        <Link
          href="/dashboard/meetings"
          className="flex-shrink-0 rounded-md border border-line px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap text-ink-2 transition-colors hover:bg-surface-3"
        >
          Connect
        </Link>
      </div>
    );
  }

  const stale = status.health === "stale";
  const tone = stale
    ? { border: "border-gold-line", bg: "bg-gold-bg", ink: "text-gold-ink" }
    : { border: "border-teal-line", bg: "bg-teal-bg", ink: "text-teal-ink" };
  const rel = status.lastSyncedAt ? relTime(now, status.lastSyncedAt) : "";
  const label =
    status.health === "never"
      ? "Fireflies connected — not synced yet"
      : stale
        ? `Fireflies last synced ${rel} — sync is overdue`
        : `Fireflies synced ${rel}`;

  const shown = recentSync.members.slice(0, 8);
  const extra = recentSync.members.length - shown.length;

  return (
    <div
      className={cn(
        "mb-4 rounded-md border border-l-[3px] px-4 py-2",
        tone.border,
        tone.bg,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[11.5px]", tone.ink)}>{label}</p>
        <SyncNowButtonCompact
          className={cn(
            "flex-shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap transition-opacity hover:opacity-80",
            tone.border,
            tone.ink,
          )}
        />
      </div>
      {recentSync.meetingCount > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={cn("text-[10px]", tone.ink)}>
            {recentSync.meetingCount} meeting
            {recentSync.meetingCount === 1 ? "" : "s"} this week
            {shown.length > 0 ? " \u00b7" : ""}
          </span>
          {shown.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/companies/${m.id}`}
              className={cn(
                "rounded-full border bg-surface px-2 py-0.5 text-[10px] whitespace-nowrap transition-opacity hover:opacity-80",
                tone.border,
                tone.ink,
              )}
            >
              {m.name}
              {m.count > 1 ? ` (${m.count})` : ""}
            </Link>
          ))}
          {extra > 0 ? (
            <span className={cn("text-[10px]", tone.ink)}>+{extra} more</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const QUICK_ACTIONS: Array<{ icon: string; label: string; href: string }> = [
  { icon: "\u2295", label: "Companies", href: "/dashboard/companies" },
  { icon: "\u25C8", label: "Projects", href: "/dashboard/projects" },
  { icon: "\u21C4", label: "Introductions", href: "/dashboard/introductions" },
  { icon: "\u25C9", label: "Contacts", href: "/dashboard/contacts" },
  { icon: "\u2726", label: "Meetings", href: "/dashboard/meetings" },
  { icon: "\u0024", label: "Invoices", href: "/dashboard/invoices" },
];
