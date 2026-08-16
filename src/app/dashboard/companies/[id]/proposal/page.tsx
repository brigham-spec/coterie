import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { readMembershipPackages } from "@/lib/membership-packages";
import {
  buildGroundingContext,
  loadKnowledgeGrounding,
} from "@/lib/knowledge-grounding";
import {
  generateMembershipProposal,
  type MembershipProposalDoc,
} from "@/lib/membership-proposal";

import { PrintButton } from "../value-report/_print-button";

// Printable membership proposal (knowledge layer, Step 2). The profile's Proposals
// card is the staff-facing pipeline log; THIS is a clean, branded, print-ready
// proposal a relationship manager Saves-as-PDF to send a prospect (the app has no
// SMTP seam, so "emailed" = the browser's Save-as-PDF, same as the value report and
// meeting brief). Staff-only: it lives under /dashboard so Clerk gates it, and the
// withOrg load 404s a company that isn't this tenant's. The app chrome is
// print-hidden by the dashboard layout so the printed output is only the sheet.
//
// PER-TENANT: the membership packages (Organization.settings) and the grounding
// collateral (KnowledgeDocs) are the org's own — nothing is hardcoded to any client.
//
// The AI prose regenerates on load (one rate-limited Opus call) and is best-effort:
// if the model call fails (rate limit / outage) the sheet still renders the verbatim
// package table and profile facts, so the document is never blocked on the AI.

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const priceFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Org settings carry no RLS → read via plain prisma, in parallel with the
  // RLS-scoped company + grounding load.
  const [org, data] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    }),
    withOrg(ctx.orgId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          industry: true,
          lookingFor: true,
          canOffer: true,
          notes: true,
          contacts: {
            orderBy: { createdAt: "asc" },
            select: { name: true, title: true },
          },
        },
      });
      if (company == null) return null;

      const grounding = await loadKnowledgeGrounding(tx);
      return { company, grounding };
    }),
  ]);

  if (data == null) notFound();

  const { company } = data;
  const packages = readMembershipPackages(org?.settings);
  const grounding = buildGroundingContext(data.grounding);

  // Best-effort AI prose. A rate-limit or model failure must not block the printable
  // package table + profile facts, so a failure yields an empty proposal and the
  // sheet renders the verbatim sections below.
  let doc: MembershipProposalDoc = {
    positioning: "",
    valueProposition: "",
    recommendedPackage: null,
    packageRationale: "",
    closing: "",
  };
  try {
    await enforceAiRateLimit(ctx.orgId);
    doc = await generateMembershipProposal({
      orgName: ctx.orgName,
      userName: ctx.userName,
      company: {
        name: company.name,
        status: company.status,
        industry: company.industry,
        lookingFor: company.lookingFor,
        canOffer: company.canOffer,
        notes: company.notes,
        contacts: company.contacts,
      },
      packages,
      grounding,
    });
  } catch (err) {
    if (!(err instanceof AiRateLimitError)) {
      console.error("membership proposal generation failed", err);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/companies/${company.id}`}
          className="text-xs font-medium tracking-[0.04em] text-ink-2 uppercase hover:text-ink"
        >
          &larr; Back to profile
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-lg border border-line bg-surface px-10 py-10 shadow-card print:rounded-none print:border-0 print:px-0 print:shadow-none">
        <header className="border-b border-line pb-6">
          <div className="text-[10px] font-medium tracking-[0.16em] text-gold uppercase">
            {ctx.orgName} &middot; Membership proposal
          </div>
          <h1 className="mt-2 font-serif text-3xl leading-tight text-ink">
            {company.name}
          </h1>
          <div className="mt-1 text-sm text-ink-3">
            {company.industry ? `${company.industry} \u00b7 ` : ""}
            {company.contacts.length > 0
              ? company.contacts
                  .map((c) => (c.title ? `${c.name} (${c.title})` : c.name))
                  .join(", ")
              : "No contacts on file"}
          </div>
        </header>

        {doc.positioning ? (
          <section className="border-b border-line py-6">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
              {doc.positioning}
            </p>
          </section>
        ) : null}

        {doc.valueProposition ? (
          <section className="border-b border-line py-6">
            <h2 className="mb-3 font-serif text-xl text-ink">
              Why {company.name}
            </h2>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">
              {doc.valueProposition}
            </p>
          </section>
        ) : null}

        {packages.length > 0 ? (
          <section className="border-b border-line py-6">
            <h2 className="mb-3 font-serif text-xl text-ink">
              Membership options
            </h2>
            <ul className="flex flex-col gap-4">
              {packages.map((p) => {
                const recommended = doc.recommendedPackage === p.name;
                return (
                  <li
                    key={p.name}
                    className={`break-inside-avoid rounded-md border px-4 py-3 ${
                      recommended
                        ? "border-gold-line bg-gold-bg"
                        : "border-line"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink">
                        {p.name}
                        {recommended ? (
                          <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
                            Recommended
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-serif text-sm text-ink">
                        {p.annualPrice != null
                          ? `${priceFmt.format(p.annualPrice)}/yr`
                          : "Custom pricing"}
                      </span>
                    </div>
                    {p.summary ? (
                      <p className="mt-1 text-sm text-ink-2">{p.summary}</p>
                    ) : null}
                    {p.includedServices.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {p.includedServices.map((s, i) => (
                          <li key={i} className="text-sm text-ink-2">
                            &middot; {s}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {doc.recommendedPackage && doc.packageRationale ? (
              <p className="mt-4 text-sm whitespace-pre-wrap text-ink-2 italic">
                {doc.packageRationale}
              </p>
            ) : null}
          </section>
        ) : null}

        {doc.closing ? (
          <section className="border-b border-line py-6 last:border-b-0">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">
              {doc.closing}
            </p>
          </section>
        ) : null}

        <footer className="mt-6 text-[11px] text-ink-3">
          Prepared by {ctx.orgName} &middot; {dayFmt.format(new Date())}
        </footer>
      </article>
    </div>
  );
}
