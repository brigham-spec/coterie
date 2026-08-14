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

import { ImportForm } from "./_import-form";

// The LinkedIn contact layer — a searchable recall tier built from a tenant's
// exported LinkedIn connections, kept separate from members/contacts. This page
// is the step-1 surface: upload the export and see the raw stated rows land,
// un-enriched. Admin-only (matches the CSV importer): non-admins get notFound()
// so the surface's existence isn't disclosed. Module-gated like the other
// optional sections.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

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

  return (
    <div className="mx-auto w-full max-w-3xl">
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
                <strong className="text-ink">{total}</strong> connections. Rows
                land <strong className="text-ink">un-enriched</strong> — the
                searchable dimensions fill in on a later pass.
              </p>
              <div className="overflow-hidden rounded-sm border border-line">
                <Table
                  head={
                    <>
                      <Th>Name</Th>
                      <Th>Company</Th>
                      <Th>Title</Th>
                      <Th>Connected</Th>
                      <Th>Enrichment</Th>
                    </>
                  }
                >
                  {recent.map((c) => (
                    <Tr key={c.id}>
                      <Td>{c.fullName}</Td>
                      <Td className="text-ink-2">{c.company || "—"}</Td>
                      <Td className="text-ink-2">{c.title || "—"}</Td>
                      <Td className="text-ink-3">
                        {c.connectedOn ? dateFmt.format(c.connectedOn) : "—"}
                      </Td>
                      <Td>
                        <TagBadge
                          label={c.enrichedAt ? "enriched" : "un-enriched"}
                          tone={c.enrichedAt ? "teal" : "slate"}
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
