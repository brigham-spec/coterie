"use client";

import { useMemo, useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";
import type { ProfileSynthesis } from "@/lib/profile-synth";

import {
  applyCompanySynthesis,
  synthesizeCompany,
  type ApplySynthResult,
  type SynthResult,
} from "./synth-actions";

// Batch profile synthesis UI (gap-audit cluster E). Pick members, run the engine
// once per member (sequentially, capped so a batch stays cheap), then review each
// proposal and apply only the fields you check. Every run and every apply is an
// explicit server action — the Anthropic key never crosses to the browser, and
// nothing is written until you Apply.

// Ceiling on one batch, matching the per-org AI rate budget. Selecting more than
// this simply runs the first RUN_CAP in list order.
const RUN_CAP = 15;

// The six writable fields, in review order. `counties` is proposed as additions
// only (the engine drops any the member already has).
const FIELDS = [
  { key: "lookingFor", label: "Looking for" },
  { key: "canOffer", label: "Can offer" },
  { key: "counties", label: "Add counties" },
  { key: "agencyContacts", label: "Agency contacts" },
  { key: "dealSize", label: "Deal size" },
  { key: "notesAppend", label: "Append to notes" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export type SynthCompany = { id: string; name: string; status: string };

// The segments offered as quick-selects, in display order. Former relationships
// are intentionally excluded — synthesis is about active members.
const GROUPS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "members", label: "Members", match: (s) => s === "member" },
  { key: "partners", label: "Partners", match: (s) => s === "strategic_partner" },
  { key: "prospects", label: "Prospects", match: (s) => s === "prospect" },
];

export function BatchSynth({ companies }: { companies: SynthCompany[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Map<string, SynthResult>>(new Map());

  // Only members/partners/prospects are offered here (former excluded).
  const eligible = useMemo(
    () => companies.filter((c) => GROUPS.some((g) => g.match(c.status))),
    [companies],
  );
  const nameById = useMemo(
    () => new Map(eligible.map((c) => [c.id, c.name] as const)),
    [eligible],
  );

  const runList = [...selected].slice(0, RUN_CAP);
  const overCap = selected.size > RUN_CAP;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectGroup(key: string) {
    const match = GROUPS.find((g) => g.key === key)?.match ?? (() => false);
    setSelected(new Set(eligible.filter((c) => match(c.status)).map((c) => c.id)));
  }

  async function run() {
    setRunning(true);
    setDone(0);
    setResults(new Map());
    for (const id of runList) {
      const res = await synthesizeCompany(id);
      setResults((prev) => new Map(prev).set(id, res));
      setDone((d) => d + 1);
    }
    setRunning(false);
  }

  return (
    <Card>
      <CardHeader
        title="Synthesize profiles"
        action={
          <Button
            type="button"
            variant="gold"
            disabled={running || runList.length === 0}
            onClick={run}
          >
            {running
              ? `Reading… ${done}/${runList.length}`
              : `Synthesize ${runList.length || ""}`.trim()}
          </Button>
        }
      />

      <div className="px-4 py-4">
        <p className="mb-3 text-xs text-ink-3">
          Read everything the network knows about each member — meetings, event
          notes, introductions, commitments, and saved research — and propose
          profile updates. Review before anything is saved.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => selectGroup(g.key)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-2 transition-colors hover:border-gold-line hover:text-gold"
            >
              All {g.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] text-ink-3 transition-colors hover:text-ink"
          >
            Clear
          </button>
          <span className="ml-auto text-[10.5px] text-ink-3">
            {selected.size} selected
          </span>
        </div>

        <div className="max-h-56 overflow-y-auto rounded-sm border border-line">
          {eligible.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-ink-3">
              No members, partners, or prospects to synthesize yet.
            </p>
          ) : (
            eligible.map((c) => {
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] text-ink-2 last:border-b-0 hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                    className="shrink-0"
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              );
            })
          )}
        </div>

        {overCap ? (
          <p className="mt-2 text-[10.5px] text-ink-3">
            Only the first {RUN_CAP} selected will run in this batch.
          </p>
        ) : null}

        {results.size > 0 ? (
          <div className="mt-4 space-y-3">
            {runList
              .filter((id) => results.has(id))
              .map((id) => (
                <ResultCard
                  key={id}
                  companyId={id}
                  name={nameById.get(id) ?? "Member"}
                  result={results.get(id)!}
                />
              ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ResultCard({
  companyId,
  name,
  result,
}: {
  companyId: string;
  name: string;
  result: SynthResult;
}) {
  const [dropped, setDropped] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ApplySynthResult | null>(null);

  if (result.status === "error") {
    return (
      <div className="rounded-md border border-line bg-surface px-3.5 py-3">
        <div className="text-[12px] font-semibold text-ink">{name}</div>
        <p className="mt-1 text-[11px] text-red-ink">{result.message}</p>
      </div>
    );
  }
  if (result.status === "empty") {
    return (
      <div className="rounded-md border border-line bg-surface px-3.5 py-3">
        <div className="text-[12px] font-semibold text-ink">{name}</div>
        <p className="mt-1 text-[11px] text-ink-3 italic">
          No new intelligence found in this member&apos;s records.
        </p>
      </div>
    );
  }

  const synthesis = result.synthesis;

  // Only the checked (non-dropped) non-empty fields are posted to apply.
  const selection = FIELDS.reduce<Record<string, string>>((acc, f) => {
    const value = synthesis[f.key as keyof ProfileSynthesis];
    if (value && !dropped[f.key]) acc[f.key] = value;
    return acc;
  }, {});
  const selectedCount = Object.keys(selection).length;

  async function apply() {
    setApplying(true);
    setApplied(await applyCompanySynthesis(companyId, selection));
    setApplying(false);
  }

  const isApplied = applied?.status === "applied";

  return (
    <div className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="text-[12px] font-semibold text-ink">{name}</div>

      {synthesis.summary ? (
        <p className="mt-1 mb-2 text-[11px] leading-relaxed text-ink-2 italic">
          {synthesis.summary}
        </p>
      ) : null}

      {isApplied ? (
        <p className="text-[11px] text-ink-2">
          Applied {applied.count} field{applied.count === 1 ? "" : "s"} to this
          profile.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {FIELDS.map((f) => {
              const value = synthesis[f.key as keyof ProfileSynthesis];
              if (!value) return null;
              const checked = !dropped[f.key];
              return (
                <label
                  key={f.key}
                  className="flex cursor-pointer gap-2 text-[11.5px] leading-relaxed text-ink-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setDropped((d) => ({ ...d, [f.key]: checked }))}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <span className="text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                      {f.label}
                    </span>
                    <br />
                    {value}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px]">
              {applied?.status === "error" ? (
                <span className="text-red-ink">{applied.message}</span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="primary"
              disabled={applying || selectedCount === 0}
              onClick={apply}
            >
              {applying ? "Applying…" : `Apply ${selectedCount} selected`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
