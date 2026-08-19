import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { Button, Card, CardHeader, PageTitle, Table, Td, Th, Tr } from "@/components/ui";

import { restoreRecord } from "./actions";

// Trash / recover (admin only). Deleting a company or contact snapshots its full
// subgraph into deleted_records, then hard-deletes from the live tables (see
// @/lib/soft-delete). This surface lists those snapshots newest first and lets an
// admin replay one back into the live tables — original ids preserved. Read-only
// list + a per-row Restore action; paginated so a long-lived org stays bounded.

const PAGE_SIZE = 50;

const KIND_LABEL: Record<string, string> = {
  company: "Company",
  contact: "Contact",
};

const stamp = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DeletedRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  // Admin-only. notFound() (rather than a thrown ForbiddenError) hides the
  // route's existence from staff, matching the module-guard idiom.
  if (ctx.role !== "admin") notFound();

  const sp = await searchParams;
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // Fetch one extra row to detect a next page without a separate count query.
  const rows = await withOrg(ctx.orgId, (tx) =>
    tx.deletedRecord.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        kind: true,
        label: true,
        createdAt: true,
      },
    }),
  );

  const hasNext = rows.length > PAGE_SIZE;
  const entries = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-3">
        <PageTitle
          title="Recently deleted"
          subtitle={`Deleted companies and contacts for ${ctx.orgName}, newest first`}
        />
        <Link href="/dashboard/settings">
          <Button>Back to settings</Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="Trash" />
        {entries.length === 0 ? (
          <p className="p-4 text-xs text-ink-3">
            {page > 1
              ? "Nothing deleted on this page."
              : "Nothing deleted. Removed companies and contacts land here, where they can be recovered."}
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Deleted</Th>
                <Th>Type</Th>
                <Th>Name</Th>
                <Th>Recover</Th>
              </>
            }
          >
            {entries.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-2">
                  {stamp.format(e.createdAt)}
                </Td>
                <Td className="whitespace-nowrap">
                  {KIND_LABEL[e.kind] ?? e.kind}
                </Td>
                <Td>{e.label}</Td>
                <Td>
                  <form action={restoreRecord}>
                    <input type="hidden" name="deletedRecordId" value={e.id} />
                    <Button type="submit">Restore</Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {(page > 1 || hasNext) && (
        <div className="mt-4 flex items-center justify-between">
          {page > 1 ? (
            <Link href={`/dashboard/settings/deleted?page=${page - 1}`}>
              <Button>Previous</Button>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-ink-3">Page {page}</span>
          {hasNext ? (
            <Link href={`/dashboard/settings/deleted?page=${page + 1}`}>
              <Button>Next</Button>
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
