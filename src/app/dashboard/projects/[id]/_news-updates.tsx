"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { getStageDef } from "@/lib/project-stages";
import type { EnrichField, ProjectProposal } from "@/lib/project-enrich";

import { saveNewsItem } from "../../news/actions";
import {
  applyProjectUpdates,
  proposeProjectUpdates,
  type ApplyEnrichResult,
  type EnrichResult,
} from "../enrich-actions";

// Project Press & News tools: a manual "Add link" (parity with the company
// profile's saved-articles card — paste a URL to save coverage straight to this
// project) and "Review updates from news" (the prototype's enrichment: read the
// project's saved coverage and propose field updates the operator applies).
// Every write is an explicit server action; nothing is saved until you click.
// A link saves straight to the project even with no associated company — the
// article attaches to the project alone (news_items.company_id is nullable).
// When a company IS linked, the save attaches to both so it also surfaces on
// that company's profile.

// A stage proposal carries the canonical value; show its human label.
function displayValue(field: EnrichField, value: string): string {
  if (value === "") return "—";
  return field === "stage" ? getStageDef(value).label : value;
}

export function ProjectNewsPanel({
  projectId,
  attachCompanyId,
  hasNews,
}: {
  projectId: string;
  attachCompanyId: string | null;
  hasNews: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          {adding ? "Close" : "Add link"}
        </button>
        {hasNews ? (
          <ReviewUpdates projectId={projectId} />
        ) : null}
      </div>

      {adding ? (
        <div className="mt-3">
          <AddLinkForm
            projectId={projectId}
            companyId={attachCompanyId}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function AddLinkForm({
  projectId,
  companyId,
  onDone,
}: {
  projectId: string;
  companyId: string | null;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        const url = String(fd.get("url") ?? "").trim();
        const title = String(fd.get("title") ?? "").trim();
        const f = new FormData();
        // Attach to the project's company when it has one; a company-less
        // project saves the link against the project alone.
        if (companyId !== null) f.set("companyId", companyId);
        f.set("projectId", projectId);
        f.set("url", url);
        // saveNewsItem requires a headline; fall back to the URL when none given
        // (matches the company card's manual-link add).
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

function ReviewUpdates({ projectId }: { projectId: string }) {
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [isReading, startReading] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          startReading(async () => setResult(await proposeProjectUpdates(projectId)))
        }
        disabled={isReading}
        className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:cursor-wait disabled:text-ink-3"
      >
        {isReading ? "Reading coverage…" : "Review updates from news"}
      </button>

      {result?.status === "error" ? (
        <p className="mt-2 w-full text-[11px] text-red-ink">{result.message}</p>
      ) : null}
      {result?.status === "empty" ? (
        <p className="mt-2 w-full text-[11px] text-ink-3 italic">
          No supported updates found in the saved coverage.
        </p>
      ) : null}
      {result?.status === "ok" ? (
        <ProposalList projectId={projectId} proposals={result.proposals} />
      ) : null}
    </>
  );
}

function ProposalList({
  projectId,
  proposals,
}: {
  projectId: string;
  proposals: ProjectProposal[];
}) {
  const [dropped, setDropped] = useState<Set<EnrichField>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ApplyEnrichResult | null>(null);

  const selection = proposals
    .filter((p) => !dropped.has(p.field))
    .map((p) => ({ field: p.field, value: p.proposedValue }));

  function toggle(field: EnrichField) {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function apply() {
    setApplying(true);
    setApplied(await applyProjectUpdates(projectId, selection));
    setApplying(false);
  }

  if (applied?.status === "applied") {
    return (
      <p className="mt-2 w-full text-[11px] text-ink-2">
        Applied {applied.count} update{applied.count === 1 ? "" : "s"} to this
        project.
      </p>
    );
  }

  return (
    <div className="mt-3 w-full space-y-2">
      {proposals.map((p) => {
        const checked = !dropped.has(p.field);
        return (
          <label
            key={p.field}
            className="flex cursor-pointer gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-ink-2"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(p.field)}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                  {p.label}
                </span>
                <ConfidenceBadge confidence={p.confidence} />
              </span>
              <span className="mt-0.5 block text-ink">
                {displayValue(p.field, p.currentValue)}{" "}
                <span className="text-ink-3">→</span> {displayValue(p.field, p.proposedValue)}
              </span>
              {p.reason ? (
                <span className="mt-0.5 block text-[10.5px] text-ink-3">{p.reason}</span>
              ) : null}
            </span>
          </label>
        );
      })}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]">
          {applied?.status === "error" ? (
            <span className="text-red-ink">{applied.message}</span>
          ) : null}
        </span>
        <Button
          type="button"
          variant="primary"
          disabled={applying || selection.length === 0}
          onClick={apply}
        >
          {applying ? "Applying…" : `Apply ${selection.length} selected`}
        </Button>
      </div>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: ProjectProposal["confidence"];
}) {
  const tone =
    confidence === "high"
      ? "bg-gold-bg text-gold-ink"
      : confidence === "low"
        ? "bg-surface-2 text-ink-3"
        : "bg-surface-2 text-ink-2";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tone}`}>
      {confidence}
    </span>
  );
}
