"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { saveNewsItem, deleteNewsItem } from "../../news/actions";

// Saved Articles & News (slice S8a, Members items 6 + 23) — the profile-parity
// port of the prototype's "Saved Articles & Links" section. Lists the coverage
// saved to this company's NewsItem ledger (the same store the org-level News
// Intelligence page writes to), lets staff paste a link directly, and offers a
// shortcut to the News scanner pre-focused on this company (item 23; the scan
// itself stays behind an explicit click there, since it is a billable search).
// Writes go through the shared news server actions, which revalidate this path.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type SavedArticle = {
  id: string;
  headline: string;
  url: string;
  summary: string | null;
  capturedAt: Date;
};

export function SavedArticlesCard({
  companyId,
  articles,
}: {
  companyId: string;
  articles: SavedArticle[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Saved Articles & News"
        action={
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/news?company=${companyId}`}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              Scan the web
            </Link>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "Add link"}
            </button>
          </div>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <AddLinkForm companyId={companyId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {articles.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No saved articles yet. Add a link or scan the web for recent coverage.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {articles.map((a) => (
            <ArticleItem key={a.id} companyId={companyId} article={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArticleItem({
  companyId,
  article,
}: {
  companyId: string;
  article: SavedArticle;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12.5px] font-medium text-ink hover:text-gold hover:underline"
        >
          {article.headline}
        </a>
        {article.summary ? (
          <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-3">
            {article.summary}
          </p>
        ) : null}
        <div className="mt-1 text-[10px] text-ink-3">
          {dateFmt.format(article.capturedAt)}
        </div>
      </div>
      <form action={deleteNewsItem} className="shrink-0">
        <input type="hidden" name="id" value={article.id} />
        <input type="hidden" name="companyId" value={companyId} />
        <button
          type="submit"
          className="text-[10px] text-ink-3 hover:text-red-ink"
        >
          Remove
        </button>
      </form>
    </li>
  );
}

function AddLinkForm({
  companyId,
  onDone,
}: {
  companyId: string;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        const url = String(fd.get("url") ?? "").trim();
        const title = String(fd.get("title") ?? "").trim();
        const f = new FormData();
        f.set("companyId", companyId);
        f.set("url", url);
        // saveNewsItem requires a headline; fall back to the URL like the
        // prototype's manual-link add does when no title is given.
        f.set("headline", title || url);
        f.set("summary", "");
        const result = await saveNewsItem(f);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        if (result.status === "exists") {
          setError("That link is already saved.");
          return;
        }
        onDone();
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap gap-2">
        <input
          name="url"
          type="url"
          required
          placeholder="Paste article URL…"
          className="min-w-0 flex-1 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        />
        <input
          name="title"
          type="text"
          placeholder="Title (optional)"
          className="w-40 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        />
        <Button type="submit" variant="gold">
          Save
        </Button>
      </div>
      {error ? <p className="text-[11px] text-red-ink">{error}</p> : null}
    </form>
  );
}
