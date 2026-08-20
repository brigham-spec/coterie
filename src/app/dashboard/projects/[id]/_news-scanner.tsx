"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui";

import {
  saveNewsItem,
  scanProjectNews,
  type ProjectNewsScanState,
  type SaveNewsResult,
} from "../../news/actions";
import type { NewsArticle } from "@/lib/news-scan";

// Project-scoped web news scan (companion to the company-level News scanner).
// A thin client shell over the scanProjectNews server action — the web-search
// discovery stays server-side. Results are ephemeral until an explicit "Save"
// persists an article to the project's associated company AND links it to this
// project in one write. A scan is a billable call, so it stays gated behind the
// explicit button (never auto-fired). If the project has no associated company
// (no developer/participant), results still surface but can't be saved.

const initialState: ProjectNewsScanState = { status: "idle" };

export function ProjectNewsScanner({ projectId }: { projectId: string }) {
  const [state, formAction, isPending] = useActionState(
    scanProjectNews,
    initialState,
  );

  return (
    <div className="border-t border-line px-4 py-3">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <Button type="submit" variant="gold" disabled={isPending}>
          {isPending ? "Scanning the web…" : "Scan the web for updates"}
        </Button>
        <span className="text-[10.5px] text-ink-3">
          Claude searches for recent coverage of this project.
        </span>
      </form>

      {state.status === "error" ? (
        <p className="mt-2 text-[11px] text-red-ink">{state.message}</p>
      ) : null}

      {state.status === "ok" ? (
        <ScanResults
          articles={state.articles}
          attachCompanyId={state.attachCompanyId}
          projectId={state.projectId}
          projectName={state.projectName}
        />
      ) : null}
    </div>
  );
}

function ScanResults({
  articles,
  attachCompanyId,
  projectId,
  projectName,
}: {
  articles: NewsArticle[];
  attachCompanyId: string | null;
  projectId: string;
  projectName: string;
}) {
  if (articles.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-ink-3 italic">
        No recent news found for {projectName}.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {articles.length} result{articles.length === 1 ? "" : "s"}
      </div>
      {attachCompanyId === null ? (
        <p className="mb-2 text-[10.5px] text-ink-3">
          Link a company (developer or participant) to this project to save
          these articles.
        </p>
      ) : null}
      <ul className="flex flex-col gap-2.5">
        {articles.map((a, i) => (
          <ScanArticle
            key={`${a.url ?? a.headline}-${i}`}
            article={a}
            attachCompanyId={attachCompanyId}
            projectId={projectId}
          />
        ))}
      </ul>
    </div>
  );
}

function ScanArticle({
  article,
  attachCompanyId,
  projectId,
}: {
  article: NewsArticle;
  attachCompanyId: string | null;
  projectId: string;
}) {
  const [result, setResult] = useState<SaveNewsResult | null>(null);
  const [isSaving, startSave] = useTransition();

  const saved = result?.status === "saved";
  const exists = result?.status === "exists";
  // Savable only with a link AND an associated company to attach to.
  const canSave = article.url !== null && attachCompanyId !== null;

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="text-[12.5px] font-semibold text-ink">
        {article.headline}
      </div>
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
              if (attachCompanyId === null || article.url === null) return;
              const f = new FormData();
              f.set("companyId", attachCompanyId);
              f.set("projectId", projectId);
              f.set("headline", article.headline);
              f.set("url", article.url);
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
                : article.url === null
                  ? "No link to save"
                  : "Save to project"}
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
          <span className="text-[11px] text-red-ink">{result.message}</span>
        ) : null}
      </div>
    </li>
  );
}
