"use client";

import { useActionState, useState, useTransition } from "react";

import { Button, Card, cn } from "@/components/ui";

import {
  addProspect,
  findProspects,
  type AddProspectResult,
  type ProspectFinderState,
} from "./actions";
import type { ProspectMode, ProspectTarget } from "@/lib/prospect-finder";

// Prospect Finder UI (slice 11.6). A client shell over the findProspects server
// action (web-search discovery stays server-side) with two modes: network-gap
// Recommendations and a filtered Targeted search. Each result can be added to the
// pipeline as a prospect (addProspect), dismissed locally, or opened on the web.
// Results are ephemeral; only an explicit "Add" persists anything.

type ContextSummary = {
  memberCount: number;
  industryCount: number;
  needsCount: number;
  activeProjects: number;
};

const initialState: ProspectFinderState = { status: "idle" };

const INDUSTRIES = [
  "Developer",
  "Construction",
  "Hospitality",
  "Architecture",
  "Owner's Rep",
  "Legal",
  "Finance & Lending",
  "Environmental",
  "Nonprofit & Cultural",
  "Healthcare",
  "Technology",
  "Other",
];
const COUNTIES = [
  "Dutchess",
  "Ulster",
  "Orange",
  "Columbia",
  "Greene",
  "Putnam",
  "Sullivan",
  "Rockland",
  "Westchester",
  "Any HV County",
];
const PROJECT_TYPES = [
  "Multifamily Residential",
  "Hospitality / Hotel",
  "Mixed-Use",
  "Master Planned",
  "Warehouse / Industrial",
  "Office / Commercial",
  "Nonprofit / Cultural",
  "Adaptive Reuse",
  "Single Family",
];
const PRESETS = [
  "Developers — Dutchess",
  "Construction — Ulster & Orange",
  "Hospitality — Catskills",
  "Capital & Lending",
  "Environmental & Civil",
  "Legal — Land Use",
  "Nonprofits & Anchors",
  "Tech & Innovation",
];

const emptyFilters = { industry: "", county: "", projectType: "", person: "" };

export function ProspectFinder({ context }: { context: ContextSummary }) {
  const [mode, setMode] = useState<ProspectMode>("recommendations");
  const [focusArea, setFocusArea] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [state, formAction, isPending] = useActionState(
    findProspects,
    initialState,
  );

  return (
    <div className="mt-4">
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ModeCard
          active={mode === "recommendations"}
          onClick={() => setMode("recommendations")}
          title="CRM Recommendations"
          sub="AI analyses your network's gaps and finds what's missing."
        />
        <ModeCard
          active={mode === "targeted"}
          onClick={() => setMode("targeted")}
          title="Targeted Search"
          sub="Search by industry, location, project type, or a specific name."
        />
      </div>

      <form action={formAction}>
        <input type="hidden" name="mode" value={mode} />
        {mode === "recommendations" ? (
          <Card>
            <div className="p-4">
              <div className="mb-1 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
                What the AI will analyse
              </div>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
                <span>
                  <strong>{context.memberCount}</strong> member profiles
                </span>
                <span>
                  <strong>{context.industryCount}</strong> industries
                </span>
                <span>
                  <strong>{context.needsCount}</strong> members with stated needs
                </span>
                <span>
                  <strong>{context.activeProjects}</strong> active projects
                </span>
              </div>
              <Button type="submit" variant="gold" disabled={isPending} className="w-full justify-center">
                {isPending ? "Analysing network…" : "Analyse network & find recommendations"}
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
                  Describe what you&apos;re looking for (optional)
                </span>
                <textarea
                  name="focusArea"
                  rows={2}
                  value={focusArea}
                  onChange={(e) => setFocusArea(e.target.value)}
                  placeholder='e.g. "Hospitality operators doing 50+ keys in the Catskills"'
                  className="w-full resize-none rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line"
                />
              </label>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <FilterSelect
                  label="Industry"
                  name="industry"
                  value={filters.industry}
                  options={INDUSTRIES}
                  onChange={(v) => setFilters((f) => ({ ...f, industry: v }))}
                />
                <FilterSelect
                  label="County / Location"
                  name="county"
                  value={filters.county}
                  options={COUNTIES}
                  onChange={(v) => setFilters((f) => ({ ...f, county: v }))}
                />
                <FilterSelect
                  label="Project type"
                  name="projectType"
                  value={filters.projectType}
                  options={PROJECT_TYPES}
                  onChange={(v) => setFilters((f) => ({ ...f, projectType: v }))}
                />
                <label className="block">
                  <span className="mb-1 block text-[9.5px] font-medium tracking-[0.05em] text-ink-3 uppercase">
                    Specific person or firm
                  </span>
                  <input
                    name="person"
                    type="text"
                    value={filters.person}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, person: e.target.value }))
                    }
                    placeholder='e.g. "Jane Smith" or "ABC Development"'
                    className="w-full rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
                  />
                </label>
              </div>

              <div>
                <div className="mb-1.5 text-[9.5px] font-medium tracking-[0.05em] text-ink-3 uppercase">
                  Quick searches
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFocusArea(p)}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2 transition-colors hover:border-gold-line hover:text-gold"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" variant="gold" disabled={isPending}>
                  {isPending ? "Searching…" : "Find prospects"}
                </Button>
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setFocusArea("");
                    setFilters(emptyFilters);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </Card>
        )}
      </form>

      {isPending ? (
        <p className="text-[11px] text-ink-3 italic">
          Reading member profiles · searching the web · scoring fit…
        </p>
      ) : state.status === "error" ? (
        <p className="text-[11px] text-red-ink">{state.message}</p>
      ) : state.status === "ok" ? (
        <Results mode={state.mode} targets={state.targets} />
      ) : null}
    </div>
  );
}

function Results({
  mode,
  targets,
}: {
  mode: ProspectMode;
  targets: ProspectTarget[];
}) {
  if (targets.length === 0) {
    return (
      <p className="text-[11px] text-ink-3 italic">
        No prospects returned. Try{" "}
        {mode === "recommendations"
          ? "Targeted Search with a specific industry or county"
          : "a different search or broader filters"}
        .
      </p>
    );
  }
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {targets.length}{" "}
        {mode === "recommendations" ? "network-gap recommendations" : "prospects found"}
      </div>
      <ul className="flex flex-col gap-2.5">
        {targets.map((t, i) => (
          <ProspectCard key={`${t.org}-${i}`} t={t} />
        ))}
      </ul>
    </div>
  );
}

function ProspectCard({ t }: { t: ProspectTarget }) {
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<AddProspectResult | null>(null);
  const [isAdding, startAdd] = useTransition();

  if (dismissed) return null;

  const added = result?.status === "added";
  const exists = result?.status === "exists";

  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink">{t.org}</div>
          <div className="mt-0.5 text-[10.5px] text-ink-3">
            {[t.contact, t.title, t.county].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-0.5" title={`Fit ${t.score}/5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                n <= t.score ? "bg-gold" : "bg-line-2",
              )}
            />
          ))}
        </span>
      </div>

      {t.why ? <p className="mt-2 text-[11.5px] text-ink-2">{t.why}</p> : null}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <MiniBox label="They get" value={t.theyGet} />
        <MiniBox label="They bring" value={t.theyBring} />
      </div>

      {t.whyNow ? (
        <p className="mt-2 text-[10.5px] text-ink-3">
          <span className="font-medium text-ink-2">Why now: </span>
          {t.whyNow}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <Button
          type="button"
          variant="gold"
          disabled={isAdding || added || exists}
          onClick={() => startAdd(async () => setResult(await addProspect(t)))}
        >
          {added
            ? "Added"
            : exists
              ? "Already tracked"
              : isAdding
                ? "Adding…"
                : "Add to pipeline"}
        </Button>
        <Button type="button" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
        {t.website ? (
          <a
            href={t.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-gold hover:underline"
          >
            Website
          </a>
        ) : null}
        {result?.status === "error" ? (
          <span className="text-[11px] text-red-ink">{result.message}</span>
        ) : null}
      </div>
    </li>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-surface-2 px-2.5 py-2">
      <div className="text-[8.5px] font-medium tracking-[0.09em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-2">{value || "—"}</div>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        active
          ? "border-gold-line bg-gold-bg"
          : "border-line bg-surface hover:border-gold-line",
      )}
    >
      <div className={cn("text-[12px] font-semibold", active ? "text-gold-ink" : "text-ink")}>
        {title}
      </div>
      <div className="mt-0.5 text-[10.5px] text-ink-3">{sub}</div>
    </button>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9.5px] font-medium tracking-[0.05em] text-ink-3 uppercase">
        {label}
      </span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
