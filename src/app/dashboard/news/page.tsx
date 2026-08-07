import { PageTitle } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { NETWORK_STATUSES } from "@/lib/company-statuses";

import { NewsScanner } from "./_news";
import { SavedArticlesList } from "./_saved-articles";

// News Intelligence (slice 11.9) — Claude searches the web for recent press,
// project announcements, and developments about a selected company, and the user
// saves the relevant ones to a persistent ledger. Thin server shell: loads the
// in-network companies to scan plus the already-saved articles, then hands off to
// the client components driving the scanNews / saveNewsItem actions (so the
// Anthropic key never crosses to the browser).

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId, userId } = await requireOrgContext();
  const sp = await searchParams;
  const rawCompany = typeof sp.company === "string" ? sp.company : "";

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
        note: true,
        keyFacts: true,
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

  // Only honour the profile shortcut's ?company= when it's a company we can
  // actually scan (formers are excluded above); otherwise start unselected.
  const initialCompanyId = scannable.some((c) => c.id === rawCompany)
    ? rawCompany
    : "";

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle
        title="News Intelligence"
        subtitle="Track recent press, project announcements, and developments across your network."
      />

      <NewsScanner
        companies={scannable}
        initialCompanyId={initialCompanyId}
        currentUserId={userId}
      />

      <SavedArticlesList
        articles={newsItems.map((n) => ({
          id: n.id,
          headline: n.headline,
          url: n.url,
          summary: n.summary,
          note: n.note,
          keyFacts: n.keyFacts,
          capturedAt: n.capturedAt,
          companyId: n.company.id,
          companyName: n.company.name,
        }))}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        currentUserId={userId}
      />
    </div>
  );
}
