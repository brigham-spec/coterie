"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { saveNewsItem, deleteNewsItem } from "./actions";

// Manual "Paste article URL" save row (slice S9a, News item 3) — the prototype's
// manual-link add on the org News page, alongside the scan-driven saved list.
// The org page isn't company-scoped (NewsItem is), so the add form carries a
// company picker the profile version doesn't need. Inputs are controlled so a
// validation error keeps the pasted URL in place. Writes go through the shared
// news server actions, which revalidate this page (and the company profile).

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export type SavedArticle = {
  id: string;
  headline: string;
  url: string;
  summary: string | null;
  capturedAt: Date;
  companyId: string;
  companyName: string;
};

export type CompanyOption = { id: string; name: string };

export function SavedArticlesList({
  articles,
  companies,
}: {
  articles: SavedArticle[];
  companies: CompanyOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Saved articles"
        action={
          <div className="flex items-center gap-3">
            {articles.length > 0 ? (
              <span className="text-[10px] text-ink-3">{articles.length}</span>
            ) : null}
            {companies.length > 0 ? (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
              >
                {adding ? "Close" : "Add link"}
              </button>
            ) : null}
          </div>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <AddLinkForm companies={companies} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {articles.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No saved articles yet. Scan a company above or add a link to build the
          ledger.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {articles.map((a) => (
            <ArticleItem key={a.id} article={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArticleItem({ article }: { article: SavedArticle }) {
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
          <Link
            href={`/dashboard/companies/${article.companyId}`}
            className="hover:text-gold"
          >
            {article.companyName}
          </Link>
          {" · "}
          {dateFmt.format(article.capturedAt)}
        </div>
      </div>
      <form action={deleteNewsItem} className="shrink-0">
        <input type="hidden" name="id" value={article.id} />
        <input type="hidden" name="companyId" value={article.companyId} />
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
  companies,
  onDone,
}: {
  companies: CompanyOption[];
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async () => {
        const f = new FormData();
        f.set("companyId", companyId);
        f.set("url", url.trim());
        // saveNewsItem requires a headline; fall back to the URL like the
        // prototype's manual-link add does when no title is given.
        f.set("headline", title.trim() || url.trim());
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
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="w-44 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        >
          <option value="">Select company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          required
          placeholder="Paste article URL…"
          className="min-w-0 flex-1 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          type="text"
          placeholder="Title (optional)"
          className="w-40 rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        />
        <Button type="submit" variant="gold" disabled={companyId === ""}>
          Save
        </Button>
      </div>
      {error ? <p className="text-[11px] text-red-ink">{error}</p> : null}
    </form>
  );
}
