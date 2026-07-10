"use client";

import { useActionState, useMemo, useState, useTransition } from "react";

import { Button, Card, cn } from "@/components/ui";

import {
  saveNewsItem,
  scanNews,
  type NewsScanState,
  type SaveNewsResult,
} from "./actions";
import type { NewsArticle } from "@/lib/news-scan";

// News scanner UI (slice 11.9). A client shell over the scanNews server action
// (web-search discovery stays server-side): pick one company, scan, then save the
// relevant results to the ledger. Results are ephemeral; only an explicit "Save"
// persists an article. A local text filter narrows a long company list.

type ScanCompany = {
  id: string;
  name: string;
  inNetwork: boolean;
  industry: string;
};

const initialState: NewsScanState = { status: "idle" };

export function NewsScanner({ companies }: { companies: ScanCompany[] }) {
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("");
  const [state, formAction, isPending] = useActionState(scanNews, initialState);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q),
    );
  }, [companies, filter]);

  return (
    <div className="mb-5 mt-4">
      <Card>
        <div className="space-y-3 p-4">
          <div className="text-[11px] text-ink-3">
            Claude searches the web for recent news, project announcements, press
            coverage, and developments for the selected company.
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter companies by name or industry…"
            className="w-full rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
          />

          {companies.length === 0 ? (
            <p className="text-[11px] text-ink-3">
              No companies to scan yet. Add one to your network first.
            </p>
          ) : (
            <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[10.5px] transition-colors",
                    c.id === selectedId
                      ? "border-gold-line bg-gold-bg text-gold-ink"
                      : "border-line bg-surface text-ink-2 hover:border-gold-line hover:text-gold",
                  )}
                  title={c.industry}
                >
                  {c.name}
                </button>
              ))}
              {visible.length === 0 ? (
                <span className="text-[10.5px] text-ink-3">No matches.</span>
              ) : null}
            </div>
          )}

          <form action={formAction}>
            <input type="hidden" name="companyId" value={selectedId} />
            <Button
              type="submit"
              variant="gold"
              disabled={isPending || selectedId === ""}
            >
              {isPending ? "Scanning the web…" : "Scan for news"}
            </Button>
          </form>
        </div>
      </Card>

      {isPending ? (
        <p className="mt-2 text-[11px] text-ink-3 italic">
          Searching the web · finding recent coverage…
        </p>
      ) : state.status === "error" ? (
        <p className="mt-2 text-[11px] text-red-600">{state.message}</p>
      ) : state.status === "ok" ? (
        <Results
          companyId={state.companyId}
          companyName={state.companyName}
          articles={state.articles}
        />
      ) : null}
    </div>
  );
}

function Results({
  companyId,
  companyName,
  articles,
}: {
  companyId: string;
  companyName: string;
  articles: NewsArticle[];
}) {
  if (articles.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-ink-3 italic">
        No recent news found for {companyName}. Try another company.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {articles.length} result{articles.length === 1 ? "" : "s"} for {companyName}
      </div>
      <ul className="flex flex-col gap-2.5">
        {articles.map((a, i) => (
          <ArticleCard key={`${a.url ?? a.headline}-${i}`} companyId={companyId} article={a} />
        ))}
      </ul>
    </div>
  );
}

function ArticleCard({
  companyId,
  article,
}: {
  companyId: string;
  article: NewsArticle;
}) {
  const [result, setResult] = useState<SaveNewsResult | null>(null);
  const [isSaving, startSave] = useTransition();

  const saved = result?.status === "saved";
  const exists = result?.status === "exists";
  const canSave = article.url !== null;

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="text-[12.5px] font-semibold text-ink">{article.headline}</div>
      <div className="mt-0.5 text-[10px] text-ink-3">
        {[article.source, article.date].filter(Boolean).join(" · ")}
      </div>
      {article.summary ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
          {article.summary}
        </p>
      ) : null}
      {article.significance ? (
        <p className="mt-1.5 text-[10.5px] text-ink-3">
          <span className="font-medium text-ink-2">Why it matters: </span>
          {article.significance}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <Button
          type="button"
          variant="gold"
          disabled={isSaving || saved || exists || !canSave}
          onClick={() =>
            startSave(async () => {
              const f = new FormData();
              f.set("companyId", companyId);
              f.set("headline", article.headline);
              f.set("url", article.url ?? "");
              f.set("summary", article.summary);
              setResult(await saveNewsItem(f));
            })
          }
        >
          {saved
            ? "Saved"
            : exists
              ? "Already saved"
              : isSaving
                ? "Saving…"
                : canSave
                  ? "Save"
                  : "No link to save"}
        </Button>
        {article.url ? (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-gold hover:underline"
          >
            Open article
          </a>
        ) : null}
        {result?.status === "error" ? (
          <span className="text-[11px] text-red-600">{result.message}</span>
        ) : null}
      </div>
    </li>
  );
}
