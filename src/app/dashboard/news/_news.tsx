"use client";

import { useMemo, useState, useTransition } from "react";

import { Button, Card, cn } from "@/components/ui";

import {
  saveNewsItem,
  scanNews,
  type NewsScanState,
  type SaveNewsResult,
} from "./actions";
import { ArticleQuickActions } from "./_article-quick-actions";
import type { NewsArticle } from "@/lib/news-scan";

// News scanner UI (slice 11.9; batch scan = slice S9b, News item 2). A client
// shell over the scanNews server action (web-search discovery stays server-side):
// pick ONE OR MANY companies, scan them, then save the relevant results to the
// ledger. Batch scans run the companies SEQUENTIALLY — one scanNews call each —
// so a live "Scanning i of n" progress reads out and the per-org AI rate limit is
// respected (a hit surfaces as that company's own error, the rest continue).
// Results stream in as each company finishes. Everything is ephemeral until an
// explicit "Save" persists an article.

type ScanCompany = {
  id: string;
  name: string;
  inNetwork: boolean;
  industry: string;
};

// One company's batch outcome. Errors are kept per-company so a single failure
// (rate limit, no key) doesn't sink the whole batch.
type CompanyResult =
  | { kind: "ok"; companyId: string; companyName: string; articles: NewsArticle[] }
  | { kind: "error"; companyId: string; companyName: string; message: string };

type Progress = { done: number; total: number; current: string };

// scanNews is a useActionState-shaped action; when driving the batch loop
// directly we pass this ignored idle "previous state".
const idleScan: NewsScanState = { status: "idle" };

export function NewsScanner({
  companies,
  initialCompanyId = "",
  currentUserId,
}: {
  companies: ScanCompany[];
  initialCompanyId?: string;
  currentUserId: string;
}) {
  // Arriving from a company profile's "Scan the web" shortcut pre-selects that
  // company (initialCompanyId) so the scan is one click away. We deliberately do
  // NOT auto-fire it: a web-search scan is a billable call, so — unlike a cheap
  // text prefill — it stays gated behind the explicit "Scan" button.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (companies.some((c) => c.id === initialCompanyId)) s.add(initialCompanyId);
    return s;
  });
  const [filter, setFilter] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [results, setResults] = useState<CompanyResult[]>([]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q),
    );
  }, [companies, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of visible) next.add(c.id);
      return next;
    });
  }

  async function runBatch() {
    const targets = companies.filter((c) => selected.has(c.id));
    if (targets.length === 0 || scanning) return;
    setScanning(true);
    setResults([]);
    const acc: CompanyResult[] = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      setProgress({ done: i + 1, total: targets.length, current: c.name });
      const fd = new FormData();
      fd.set("companyId", c.id);
      // Sequential on purpose: bounded AI spend + a readable progress count.
      const state = await scanNews(idleScan, fd);
      if (state.status === "ok") {
        acc.push({
          kind: "ok",
          companyId: state.companyId,
          companyName: state.companyName,
          articles: state.articles,
        });
      } else if (state.status === "error") {
        acc.push({
          kind: "error",
          companyId: c.id,
          companyName: c.name,
          message: state.message,
        });
      }
      // Stream results in as each company finishes.
      setResults([...acc]);
    }
    setProgress(null);
    setScanning(false);
  }

  const count = selected.size;

  return (
    <div className="mb-5 mt-4">
      <Card>
        <div className="space-y-3 p-4">
          <div className="text-[11px] text-ink-3">
            Claude searches the web for recent news, project announcements, press
            coverage, and developments for each selected company.
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
            <>
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-ink-3">
                <span>{count} selected</span>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={scanning || visible.length === 0}
                  className="font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
                >
                  Select all shown
                </button>
                {count > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={scanning}
                    className="font-medium tracking-[0.06em] text-ink-2 uppercase hover:text-gold disabled:opacity-40"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {visible.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    disabled={scanning}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10.5px] transition-colors disabled:opacity-50",
                      selected.has(c.id)
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
            </>
          )}

          <Button
            type="button"
            variant="gold"
            onClick={runBatch}
            disabled={scanning || count === 0}
          >
            {scanning
              ? "Scanning the web…"
              : `Scan ${count} compan${count === 1 ? "y" : "ies"}`}
          </Button>
        </div>
      </Card>

      {scanning && progress ? (
        <p className="mt-2 text-[11px] text-ink-3 italic">
          Scanning {progress.done} of {progress.total}
          {progress.current ? ` · ${progress.current}` : ""}…
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-3 flex flex-col gap-4">
          {results.map((r) =>
            r.kind === "error" ? (
              <p key={r.companyId} className="text-[11px] text-red-ink">
                {r.companyName}: {r.message}
              </p>
            ) : (
              <CompanyResults
                key={r.companyId}
                companyId={r.companyId}
                companyName={r.companyName}
                articles={r.articles}
                currentUserId={currentUserId}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function CompanyResults({
  companyId,
  companyName,
  articles,
  currentUserId,
}: {
  companyId: string;
  companyName: string;
  articles: NewsArticle[];
  currentUserId: string;
}) {
  if (articles.length === 0) {
    return (
      <p className="text-[11px] text-ink-3 italic">
        No recent news found for {companyName}.
      </p>
    );
  }
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {articles.length} result{articles.length === 1 ? "" : "s"} for {companyName}
      </div>
      <ul className="flex flex-col gap-2.5">
        {articles.map((a, i) => (
          <ArticleCard
            key={`${a.url ?? a.headline}-${i}`}
            companyId={companyId}
            article={a}
            currentUserId={currentUserId}
          />
        ))}
      </ul>
    </div>
  );
}

function ArticleCard({
  companyId,
  article,
  currentUserId,
}: {
  companyId: string;
  article: NewsArticle;
  currentUserId: string;
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
      {article.keyFacts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {article.keyFacts.map((f, i) => (
            <span
              key={`${f}-${i}`}
              className="rounded-full bg-gold-bg px-2 py-0.5 text-[10px] text-gold-ink"
            >
              {f}
            </span>
          ))}
        </div>
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
              f.set("keyFacts", JSON.stringify(article.keyFacts));
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
        <ArticleQuickActions
          companyId={companyId}
          headline={article.headline}
          url={article.url}
          currentUserId={currentUserId}
        />
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
          <span className="text-[11px] text-red-ink">{result.message}</span>
        ) : null}
      </div>
    </li>
  );
}
