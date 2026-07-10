import Link from "next/link";

import { PageTitle, Card, CardHeader, TagBadge } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";

import { EmailSync } from "./_email";
import { deleteEmailMessage } from "./actions";

// Email Intelligence (slice 11.12) — a Zapier zap has Claude analyse each inbound
// email and append a row to a published Google Sheet; syncing pulls that CSV,
// matches each row to a company, and lands it in the EmailMessage ledger. Thin
// server shell: reads the saved sheet URL off the org, loads the synced messages
// grouped by company, and hands the sync/save flow to the client component.

const UNMATCHED = "__unmatched";

function sentimentTone(sentiment: string): string {
  const v = sentiment.toLowerCase();
  if (v === "positive") return "teal";
  if (v === "negative") return "red";
  return "slate";
}

function actionItemCount(raw: string): number {
  return raw.split(/[;\n]/).filter((s) => s.trim() !== "").length;
}

export default async function EmailPage() {
  const { orgId } = await requireOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings =
    org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
      ? (org.settings as Record<string, unknown>)
      : {};
  const savedUrl =
    typeof settings.emailSheetUrl === "string" ? settings.emailSheetUrl : "";

  const emails = await withOrg(orgId, (tx) =>
    tx.emailMessage.findMany({
      orderBy: { syncedAt: "desc" },
      select: {
        id: true,
        subject: true,
        summary: true,
        projects: true,
        actionItems: true,
        sentiment: true,
        emailDate: true,
        fromName: true,
        fromEmail: true,
        syncedAt: true,
        company: { select: { id: true, name: true } },
      },
    }),
  );

  const lastSync = emails[0]?.syncedAt ?? null;

  // Group by matched company; unmatched mail collects under a trailing bucket.
  const groups = new Map<
    string,
    { name: string; companyId: string | null; emails: typeof emails }
  >();
  for (const e of emails) {
    const key = e.company?.id ?? UNMATCHED;
    if (!groups.has(key))
      groups.set(key, {
        name: e.company?.name ?? "Unmatched",
        companyId: e.company?.id ?? null,
        emails: [],
      });
    groups.get(key)!.emails.push(e);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.companyId === null) return 1;
    if (b.companyId === null) return -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle
        title="Email Intelligence"
        subtitle="Sync Claude-analysed client emails from your Zapier sheet and match them to your network."
      />

      <EmailSync savedUrl={savedUrl} lastSync={lastSync ? lastSync.toISOString() : null} />

      {emails.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-xs text-ink-3">
            No emails synced yet. Connect your published Google Sheet above and
            sync to see correspondence grouped by company.
          </p>
        </Card>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {ordered.map((g) => (
            <Card key={g.companyId ?? UNMATCHED}>
              <CardHeader
                title={
                  g.companyId ? (
                    <Link
                      href={`/dashboard/companies/${g.companyId}`}
                      className="hover:text-gold"
                    >
                      {g.name}
                    </Link>
                  ) : (
                    g.name
                  )
                }
                action={
                  <span className="text-[10px] text-ink-3">
                    {g.emails.length} email{g.emails.length === 1 ? "" : "s"}
                  </span>
                }
              />
              <ul className="divide-y divide-line">
                {g.emails.map((e) => {
                  const aiCount = actionItemCount(e.actionItems);
                  return (
                    <li key={e.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-ink">
                            {e.subject || "(no subject)"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-ink-3">
                            {[e.fromName || e.fromEmail, e.emailDate]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {e.sentiment ? (
                            <TagBadge label={e.sentiment} tone={sentimentTone(e.sentiment)} />
                          ) : null}
                          <form action={deleteEmailMessage}>
                            <input type="hidden" name="id" value={e.id} />
                            <button
                              type="submit"
                              className="text-[10px] text-ink-3 hover:text-red-ink"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                      {e.summary ? (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
                          {e.summary}
                        </p>
                      ) : null}
                      {e.projects ? (
                        <p className="mt-1 text-[10.5px] text-teal-ink">
                          <span className="font-medium">Projects: </span>
                          {e.projects}
                        </p>
                      ) : null}
                      {aiCount > 0 ? (
                        <p className="mt-1 text-[10.5px] text-gold-ink">
                          {aiCount} action item{aiCount === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
