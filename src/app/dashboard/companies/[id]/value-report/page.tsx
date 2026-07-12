import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { VALUE_KIND_DEFS } from "@/lib/value-kinds";
import { buildValueReport } from "@/lib/value-delivered";

import { PrintButton } from "./_print-button";

// Shareable member Value Report (P4 follow-on). The Value Delivered card is the
// staff-facing ledger; this is the same data presented BACK to the member as a
// clean, branded, print-ready document. Staff open it and Save-as-PDF to email
// or drop into a deck. Staff-only: it lives under /dashboard so Clerk gates it,
// and the withOrg load 404s a company that isn't this tenant's. The app chrome
// (sidebar / topbar) is print-hidden in the dashboard layout so the printed
// output is only the report sheet.

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

const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const kindLabel = new Map(VALUE_KIND_DEFS.map((k) => [k.value, k.label]));

export default async function ValueReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  const data = await withOrg(ctx.orgId, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id },
      select: { id: true, name: true, industry: true },
    });
    if (company == null) return null;

    const entries = await tx.valueDelivered.findMany({
      where: { companyId: id },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        kind: true,
        amount: true,
        summary: true,
        outcome: true,
        occurredAt: true,
        introduction: {
          select: {
            partyA: { select: { name: true } },
            partyB: { select: { name: true } },
          },
        },
      },
    });

    return { company, entries };
  });

  if (data == null) notFound();

  const report = buildValueReport(
    data.entries.map((v) => ({
      id: v.id,
      kind: v.kind,
      amount: v.amount == null ? null : Number(v.amount),
      summary: v.summary,
      outcome: v.outcome,
      occurredAt: v.occurredAt,
      introLabel: v.introduction
        ? `${v.introduction.partyA.name} \u2194 ${v.introduction.partyB.name}`
        : null,
    })),
  );

  const period =
    report.firstAt && report.lastAt
      ? report.firstAt.getTime() === report.lastAt.getTime()
        ? monthFmt.format(report.lastAt)
        : `${monthFmt.format(report.firstAt)} \u2013 ${monthFmt.format(report.lastAt)}`
      : null;

  // Bar basis mirrors the profile card: dollars when any win carries a figure,
  // else counts so non-monetary wins still chart.
  const useAmount = report.summary.totalAmount > 0;
  const barMax = Math.max(
    1,
    ...report.sections.map((s) => (useAmount ? s.amount : s.count)),
  );

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
            {ctx.orgName}
          </div>
          <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">
            Value delivered to {data.company.name}
          </h1>
          <div className="mt-1 text-sm text-ink-3">
            {data.company.industry ? `${data.company.industry} \u00b7 ` : ""}
            {period ?? "Membership summary"}
          </div>
        </header>

        {report.summary.entryCount === 0 ? (
          <p className="py-10 text-sm text-ink-3">
            No value has been logged for this member yet.
          </p>
        ) : (
          <>
            <section className="border-b border-line py-6">
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-4xl text-ink">
                  {currency.format(report.summary.totalAmount)}
                </span>
                <span className="text-sm text-ink-2">
                  delivered across {report.summary.entryCount}{" "}
                  {report.summary.entryCount === 1 ? "win" : "wins"}
                  {report.summary.monetaryCount > 0 &&
                  report.summary.monetaryCount < report.summary.entryCount
                    ? ` (${report.summary.monetaryCount} with a dollar figure)`
                    : ""}
                </span>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                {report.sections.map((s) => {
                  const magnitude = useAmount ? s.amount : s.count;
                  const pct = Math.round((magnitude / barMax) * 100);
                  return (
                    <div key={s.kind} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[11px] tracking-[0.04em] text-ink-2 uppercase">
                        {kindLabel.get(s.kind) ?? s.kind}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3 print:border print:border-line">
                        <div
                          className="h-full rounded-full bg-gold"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right text-[11px] text-ink-2">
                        {s.amount > 0 ? currency.format(s.amount) : `${s.count}\u00d7`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {report.sections.map((s) => (
              <section
                key={s.kind}
                className="border-b border-line py-6 last:border-b-0"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-serif text-xl text-ink">
                    {kindLabel.get(s.kind) ?? s.kind}
                  </h2>
                  <span className="text-xs text-ink-3">
                    {s.count} {s.count === 1 ? "entry" : "entries"}
                    {s.amount > 0 ? ` \u00b7 ${currency.format(s.amount)}` : ""}
                  </span>
                </div>
                <ul className="flex flex-col gap-4">
                  {s.entries.map((e) => (
                    <li key={e.id} className="break-inside-avoid">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-ink">
                          {e.summary}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">
                          {dayFmt.format(e.occurredAt)}
                        </span>
                      </div>
                      {e.amount != null ? (
                        <div className="mt-0.5 text-sm font-medium text-gold">
                          {currency.format(e.amount)}
                        </div>
                      ) : null}
                      {e.outcome ? (
                        <p className="mt-1 text-sm whitespace-pre-wrap text-ink-2">
                          {e.outcome}
                        </p>
                      ) : null}
                      {e.introLabel ? (
                        <div className="mt-1 text-xs text-ink-3">
                          From introduction: {e.introLabel}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        <footer className="mt-6 text-[11px] text-ink-3">
          Prepared by {ctx.orgName} &middot; {dayFmt.format(new Date())}
        </footer>
      </article>
    </div>
  );
}
