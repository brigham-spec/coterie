import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";
import {
  Card,
  CardHeader,
  PageTitle,
  Table,
  TagBadge,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { EnrichButton } from "./_enrich-button";
import { ImportForm } from "./_import-form";

// The LinkedIn contact layer — a searchable recall tier built from a tenant's
// exported LinkedIn connections, kept separate from members/contacts. This page
// is the step-1/2 surface: upload the export (rows land un-enriched), then run the
// bulk enrichment pass that fills the inferred dimensions. Admin-only (matches the
// CSV importer): non-admins get notFound() so the surface's existence isn't
// disclosed. Module-gated like the other optional sections.
//
// Integrity is the point of this layer, so the display never lets an inference
// pass as fact: stated columns (Company/Title) are shown plainly, while each
// inferred dimension carries a visible "inferred" marker + its high/low confidence
// grade. An un-enriched row shows an em-dash, not a guess.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// One inferred dimension cell: the value with a visible provenance marker (never
// bare), or an em-dash when there's no inference. The confidence grade tints the
// badge so a low-confidence call reads differently from a high-confidence one.
function InferredCell({
  value,
  confidence,
}: {
  value: string | null;
  confidence: string | null;
}) {
  if (!value) return <span className="text-ink-3">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink">{value}</span>
      <TagBadge
        label={`inferred · ${confidence ?? "low"}`}
        tone={confidence === "high" ? "teal" : "slate"}
      />
    </div>
  );
}

export default async function LinkedinPage() {
  await requireModule("linkedin");
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") notFound();

  const { total, enriched, recent, lastExportedOn } = await withOrg(
    ctx.orgId,
    async (tx) => {
      // Sequential: one pooled connection per withOrg tx (never Promise.all).
      const total = await tx.linkedinContact.count();
      const enriched = await tx.linkedinContact.count({
        where: { enrichedAt: { not: null } },
      });
      const recent = await tx.linkedinContact.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          fullName: true,
          company: true,
          title: true,
          connectedOn: true,
          enrichedAt: true,
          industry: true,
          industryConfidence: true,
          seniority: true,
          seniorityConfidence: true,
          jobFunction: true,
          jobFunctionConfidence: true,
        },
      });
      const latestImport = await tx.linkedinImport.findFirst({
        where: { exportedOn: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { exportedOn: true },
      });
      return {
        total,
        enriched,
        recent,
        lastExportedOn: latestImport?.exportedOn ?? null,
      };
    },
  );

  const pending = total - enriched;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="LinkedIn"
          subtitle={`A searchable recall layer built from ${ctx.orgName}'s exported LinkedIn connections`}
        />
      </div>

      <Card>
        <CardHeader title="Import LinkedIn connections" />
        <div className="p-4">
          <ImportForm />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Enrichment"
          action={
            <span className="text-[11px] text-ink-2">
              {enriched} of {total} enriched
            </span>
          }
        />
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-ink-2">
            Enrichment infers each connection&rsquo;s{" "}
            <strong className="text-ink">industry</strong>,{" "}
            <strong className="text-ink">seniority</strong>, and{" "}
            <strong className="text-ink">function</strong> from their stated name,
            company, and title. Every inferred value is marked{" "}
            <strong className="text-ink">inferred</strong> and graded for
            confidence — it never implies more certainty than the stated fields
            support. Geography is left for the promotion pass.
          </p>
          <EnrichButton pending={pending} />
          {pending === 0 && total > 0 ? (
            <p className="text-xs text-ink-3">
              All imported connections are enriched.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Imported connections"
          action={
            <span className="text-[11px] text-ink-2">
              {enriched} of {total} enriched
              {lastExportedOn
                ? ` · export ${dateFmt.format(lastExportedOn)}`
                : ""}
            </span>
          }
        />
        <div className="p-4">
          {total === 0 ? (
            <p className="text-xs text-ink-3">
              No connections imported yet. Upload your LinkedIn
              &ldquo;Connections.csv&rdquo; export above.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-2">
                Showing the {recent.length} most recent of{" "}
                <strong className="text-ink">{total}</strong> connections.{" "}
                <span className="text-ink-3">Company</span> and{" "}
                <span className="text-ink-3">Title</span> are stated verbatim from
                the export; <span className="text-ink-3">Industry</span>,{" "}
                <span className="text-ink-3">Seniority</span>, and{" "}
                <span className="text-ink-3">Function</span> are inferred and
                marked as such.
              </p>
              <div className="overflow-hidden rounded-sm border border-line">
                <Table
                  head={
                    <>
                      <Th>Name</Th>
                      <Th>Company</Th>
                      <Th>Title</Th>
                      <Th>Industry</Th>
                      <Th>Seniority</Th>
                      <Th>Function</Th>
                    </>
                  }
                >
                  {recent.map((c) => (
                    <Tr key={c.id}>
                      <Td>{c.fullName}</Td>
                      <Td className="text-ink-2">{c.company || "—"}</Td>
                      <Td className="text-ink-2">{c.title || "—"}</Td>
                      <Td>
                        <InferredCell
                          value={c.industry}
                          confidence={c.industryConfidence}
                        />
                      </Td>
                      <Td>
                        <InferredCell
                          value={c.seniority}
                          confidence={c.seniorityConfidence}
                        />
                      </Td>
                      <Td>
                        <InferredCell
                          value={c.jobFunction}
                          confidence={c.jobFunctionConfidence}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Table>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
