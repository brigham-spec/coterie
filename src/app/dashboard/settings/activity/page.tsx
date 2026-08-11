import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { describeActivity } from "@/lib/audit-log";
import { Button, Card, CardHeader, PageTitle, Table, Td, Th, Tr } from "@/components/ui";

// Org-wide audit log (admin only). The company profile shows one firm's status
// history; this surfaces every lifecycle activity across the whole network with
// actor attribution, newest first — the tenant admin's record of who changed
// what and when. Read-only over the Activity model (see @/lib/activity),
// paginated so a long-lived org's history stays bounded per page.

const PAGE_SIZE = 50;

const stamp = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ActivityLogPage({
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
    tx.activity.findMany({
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        type: true,
        payload: true,
        occurredAt: true,
        company: { select: { id: true, name: true } },
        actor: { select: { name: true } },
      },
    }),
  );

  const hasNext = rows.length > PAGE_SIZE;
  const entries = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-3">
        <PageTitle
          title="Activity log"
          subtitle={`Lifecycle activity across ${ctx.orgName}, newest first`}
        />
        <Link href="/dashboard/settings">
          <Button>Back to settings</Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="Recent activity" />
        {entries.length === 0 ? (
          <p className="p-4 text-xs text-ink-3">
            {page > 1
              ? "No activity on this page."
              : "No activity recorded yet."}
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>When</Th>
                <Th>Company</Th>
                <Th>Action</Th>
                <Th>Detail</Th>
                <Th>By</Th>
              </>
            }
          >
            {entries.map((e) => {
              const { action, detail } = describeActivity(e.type, e.payload);
              return (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-ink-2">
                    {stamp.format(e.occurredAt)}
                  </Td>
                  <Td>
                    <Link
                      href={`/dashboard/companies/${e.company.id}`}
                      className="text-teal-ink hover:underline"
                    >
                      {e.company.name}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{action}</Td>
                  <Td className="text-ink-2">{detail ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-ink-2">
                    {e.actor?.name ?? "System"}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      {(page > 1 || hasNext) && (
        <div className="mt-4 flex items-center justify-between">
          {page > 1 ? (
            <Link href={`/dashboard/settings/activity?page=${page - 1}`}>
              <Button>Previous</Button>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-ink-3">Page {page}</span>
          {hasNext ? (
            <Link href={`/dashboard/settings/activity?page=${page + 1}`}>
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
