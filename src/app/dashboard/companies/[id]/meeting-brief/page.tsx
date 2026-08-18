import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getStageDef } from "@/lib/project-stages";
import { projectLinkRoleLabel } from "@/lib/project-roles";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  splitIntroValue,
  summarizeValueDelivered,
} from "@/lib/value-delivered";
import {
  generateMeetingPrep,
  type MeetingPrepBrief,
  type PrepValueSnapshot,
} from "@/lib/meeting-prep";
import {
  loadMeetingBriefData,
  briefCommitments,
  briefValueEntries,
  briefCandidates,
  buildMeetingPrepInput,
} from "@/lib/meeting-brief-data";

import { PrintButton } from "../value-report/_print-button";

// Printable / emailable pre-meeting brief (P4 follow-on to the profile's Meeting
// prep card). The card is the quick, on-screen glance; THIS is the same brief as a
// clean, branded, print-ready sheet a relationship manager takes IN FRONT OF the
// member to lead the conversation — Save-as-PDF to email or drop into a deck (the
// app has no SMTP seam, so "emailed" = the browser's Save-as-PDF, same as the value
// report). Staff-only: it lives under /dashboard so Clerk gates it, and the withOrg
// load 404s a company that isn't this tenant's. The app chrome is print-hidden by
// the dashboard layout so the printed output is only the brief sheet.
//
// Unlike the value report, this sheet regenerates the AI narrative on load (one
// rate-limited Opus call). The narrative is best-effort: if the model call fails
// (rate limit / outage) the sheet still renders every verbatim fact section, so the
// document is never blocked on the AI.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function MeetingBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const data = await withOrg(ctx.orgId, (tx) =>
    loadMeetingBriefData(tx, id),
  );

  if (data == null) notFound();

  const commitments = briefCommitments(data);

  // The full value ledger (manual rows carrying their introduction label, folded
  // with the derived network value) split into the three-part story the sheet
  // leads with: introductions made, monetary wins traced back to an introduction,
  // and any other value delivered.
  const allEntries = briefValueEntries(data, id);
  const valueSplit = splitIntroValue(allEntries);
  const summary = summarizeValueDelivered(allEntries);
  const valueSnapshot: PrepValueSnapshot = {
    totalAmount: summary.totalAmount,
    entryCount: summary.entryCount,
    monetaryCount: summary.monetaryCount,
  };

  const candidates = briefCandidates(data, id);

  // Best-effort AI narrative + grounded intro recommendations. A rate-limit or
  // model failure must not block the printable facts, so a failure yields an empty
  // brief and the sheet renders every verbatim section below.
  let brief: MeetingPrepBrief = { narrative: "", introRecommendations: [] };
  try {
    await enforceAiRateLimit(ctx.orgId);
    brief = await generateMeetingPrep(
      buildMeetingPrepInput(data, {
        userName: ctx.userName,
        commitments,
        valueSnapshot,
        candidates,
      }),
    );
  } catch (err) {
    if (!(err instanceof AiRateLimitError)) {
      console.error("meeting brief narrative failed", err);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/companies/${data.company.id}`}
          className="text-xs font-medium tracking-[0.04em] text-ink-2 uppercase hover:text-ink"
        >
          &larr; Back to profile
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-lg border border-line bg-surface px-10 py-10 shadow-card print:rounded-none print:border-0 print:px-0 print:shadow-none">
        <header className="border-b border-line pb-6">
          <div className="text-[10px] font-medium tracking-[0.16em] text-gold uppercase">
            {ctx.orgName} &middot; Meeting brief
          </div>
          <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">
            {data.company.name}
          </h1>
          <div className="mt-1 text-sm text-ink-3">
            {data.company.industry ? `${data.company.industry} \u00b7 ` : ""}
            {data.company.tier ? `${data.company.tier} \u00b7 ` : ""}
            {data.company.contacts.length > 0
              ? data.company.contacts
                  .map((c) => (c.title ? `${c.name} (${c.title})` : c.name))
                  .join(", ")
              : "No contacts on file"}
          </div>
        </header>

        {brief.narrative ? (
          <section className="border-b border-line py-6">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink italic">
              {brief.narrative}
            </p>
          </section>
        ) : null}

        {data.recentMeetings.length > 0 ? (
          <section className="border-b border-line py-6">
            <h2 className="mb-3 font-serif text-xl text-ink">
              Where things left off
            </h2>
            <ul className="flex flex-col gap-3">
              {data.recentMeetings.map((m, i) => (
                <li key={i} className="break-inside-avoid">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{m.title}</span>
                    <span className="shrink-0 text-xs text-ink-3">
                      {dayFmt.format(m.heldAt)}
                    </span>
                  </div>
                  {m.summary ? (
                    <p className="mt-1 text-sm whitespace-pre-wrap text-ink-2">
                      {m.summary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {commitments.length > 0 ? (
          <section className="border-b border-line py-6">
            <h2 className="mb-3 font-serif text-xl text-ink">
              Outstanding action items
            </h2>
            <ul className="flex flex-col gap-2">
              {commitments.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 break-inside-avoid text-sm"
                >
                  <span className="w-20 shrink-0 text-[11px] tracking-[0.04em] text-ink-3 uppercase">
                    {c.owedBy === "us" ? "We owe" : "They owe"}
                  </span>
                  <span className="text-ink-2">{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {brief.introRecommendations.length > 0 ? (
          <section className="border-b border-line py-6">
            <h2 className="mb-3 font-serif text-xl text-ink">
              Introductions to make
            </h2>
            <ul className="flex flex-col gap-3">
              {brief.introRecommendations.map((rec) => (
                <li key={rec.companyId} className="break-inside-avoid">
                  <span className="text-sm font-medium text-ink">
                    {rec.companyName}
                  </span>
                  {rec.reason ? (
                    <p className="mt-0.5 text-sm text-ink-2">{rec.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-b border-line py-6">
          <h2 className="mb-3 font-serif text-xl text-ink">Value delivered</h2>

          {valueSplit.introsMade.length === 0 &&
          valueSplit.winsFromIntros.length === 0 &&
          valueSplit.otherValue.length === 0 ? (
            <p className="text-sm text-ink-3">
              No network value recorded for this member yet.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {valueSplit.introsMade.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-[11px] font-medium tracking-[0.06em] text-ink-2 uppercase">
                      Introductions made
                    </h3>
                    <span className="text-xs text-ink-3">
                      {valueSplit.introsMade.length}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {valueSplit.introsMade.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-baseline justify-between gap-3 break-inside-avoid text-sm"
                      >
                        <span className="text-ink-2">{e.summary}</span>
                        <span className="shrink-0 text-xs text-ink-3">
                          {dayFmt.format(e.occurredAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {valueSplit.winsFromIntros.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-[11px] font-medium tracking-[0.06em] text-gold uppercase">
                      Won from introductions
                    </h3>
                    <span className="font-serif text-sm text-ink">
                      {currency.format(valueSplit.winsTotal)}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {valueSplit.winsFromIntros.map((e) => (
                      <li key={e.id} className="break-inside-avoid">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-ink">
                            {e.summary}
                          </span>
                          <span className="shrink-0 text-sm font-medium text-gold">
                            {currency.format(e.amount ?? 0)}
                          </span>
                        </div>
                        {e.outcome ? (
                          <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink-2">
                            {e.outcome}
                          </p>
                        ) : null}
                        {e.introLabel ? (
                          <div className="mt-0.5 text-xs text-ink-3">
                            From introduction: {e.introLabel}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {valueSplit.otherValue.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-ink-2 uppercase">
                    Other value delivered
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {valueSplit.otherValue.map((e) => (
                      <li key={e.id} className="break-inside-avoid">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-ink">
                            {e.summary}
                          </span>
                          <span className="shrink-0 text-xs text-ink-3">
                            {e.amount != null
                              ? currency.format(e.amount)
                              : dayFmt.format(e.occurredAt)}
                          </span>
                        </div>
                        {e.outcome ? (
                          <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink-2">
                            {e.outcome}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {data.company.projectLinks.length > 0 ? (
          <section className="border-b border-line py-6 last:border-b-0">
            <h2 className="mb-3 font-serif text-xl text-ink">Linked projects</h2>
            <ul className="flex flex-col gap-2.5">
              {data.company.projectLinks.map((l) => {
                const stage = getStageDef(l.project.stage);
                return (
                  <li
                    key={l.projectId}
                    className="flex items-baseline justify-between gap-3 break-inside-avoid"
                  >
                    <div>
                      <span className="text-sm font-medium text-ink">
                        {l.project.name}
                      </span>
                      <span className="text-xs text-ink-3">
                        {" \u00b7 "}
                        {projectLinkRoleLabel(l.role)}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] tracking-[0.04em] text-ink-2 uppercase">
                      {stage.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {data.newsItems.length > 0 ? (
          <section className="border-b border-line py-6 last:border-b-0">
            <h2 className="mb-3 font-serif text-xl text-ink">News to mention</h2>
            <ul className="flex flex-col gap-2">
              {data.newsItems.map((n, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3 break-inside-avoid text-sm"
                >
                  <span className="text-ink-2">{n.headline}</span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {dayFmt.format(n.capturedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="mt-6 text-[11px] text-ink-3">
          Prepared by {ctx.orgName} &middot; {dayFmt.format(new Date())}
        </footer>
      </article>
    </div>
  );
}
