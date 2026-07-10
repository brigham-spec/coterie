import Link from "next/link";

import { PageTitle, Card, CardHeader } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { NETWORK_STATUSES } from "@/lib/company-statuses";

import { NewsScanner } from "./_news";
import { deleteNewsItem } from "./actions";

// News Intelligence (slice 11.9) — Claude searches the web for recent press,
// project announcements, and developments about a selected company, and the user
// saves the relevant ones to a persistent ledger. Thin server shell: loads the
// in-network companies to scan plus the already-saved articles, then hands off to
// the client component driving the scanNews / saveNewsItem actions (so the
// Anthropic key never crosses to the browser).

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function NewsPage() {
  const { orgId } = await requireOrgContext();

  const { companies, newsItems } = await withOrg(orgId, async (tx) => {
    const companies = await tx.company.findMany({
      where: { status: { not: "former" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, industry: true },
    });
    const newsItems = await tx.newsItem.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        headline: true,
        url: true,
        summary: true,
        capturedAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    return { companies, newsItems };
  });

  // Scanning is most useful for in-network relationships; prospects included too
  // (they're the pipeline you're actively tracking), formers already excluded.
  const scannable = companies.map((c) => ({
    id: c.id,
    name: c.name,
    inNetwork: NETWORK_STATUSES.includes(c.status),
    industry: c.industry,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle
        title="News Intelligence"
        subtitle="Track recent press, project announcements, and developments across your network."
      />

      <NewsScanner companies={scannable} />

      <Card>
        <CardHeader
          title="Saved articles"
          action={
            newsItems.length > 0 ? (
              <span className="text-[10px] text-ink-3">{newsItems.length}</span>
            ) : null
          }
        />
        {newsItems.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No saved articles yet. Scan a company above and save the relevant
            results here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {newsItems.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12.5px] font-medium text-ink hover:text-gold hover:underline"
                  >
                    {n.headline}
                  </a>
                  {n.summary ? (
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-3">
                      {n.summary}
                    </p>
                  ) : null}
                  <div className="mt-1 text-[10px] text-ink-3">
                    <Link
                      href={`/dashboard/companies/${n.company.id}`}
                      className="hover:text-gold"
                    >
                      {n.company.name}
                    </Link>
                    {" · "}
                    {dateFmt.format(n.capturedAt)}
                  </div>
                </div>
                <form action={deleteNewsItem} className="shrink-0">
                  <input type="hidden" name="id" value={n.id} />
                  <button
                    type="submit"
                    className="text-[10px] text-ink-3 hover:text-red-ink"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
