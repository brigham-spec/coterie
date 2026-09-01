"use client";

import { useMemo, useState } from "react";

import { Button, Card, CardHeader, cn } from "@/components/ui";
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

// Ceiling on one batch — generous enough to synthesize a whole network in one
// pass, bounded well under the per-org daily AI budget (300/day). Selecting more
// than this simply runs the first RUN_CAP in list order.
const RUN_CAP = 100;

// The server allows ~20 AI calls/minute per org (DEFAULT_CAPS.minuteCap). Space
// each call start at least this far apart so a large batch stays under that burst
// cap and never drops a member; when a call already took longer, we don't wait.
// ~3.6s ⇒ at most ~17 starts in any 60s window, comfortably below 20.
const MIN_SPACING_MS = 3600;

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

export type SynthCompany = {
  id: string;
  name: string;
  status: string;
  // Epoch ms of the last synthesis run, or null if never synthesized.
  lastSynthesizedAt: number | null;
};

// PURE: short "last synthesized" label for a member row. Null → never; otherwise
// a coarse relative age (today / Nd / Nw / Nmo) so operators can spot stale ones.
function lastSynthLabel(ms: number | null, now: number): string {
  if (ms == null) return "Never synthesized";
  const days = Math.floor((now - ms) / 86_400_000);
  if (days <= 0) return "Synthesized today";
  if (days < 7) return `Synthesized ${days}d ago`;
  if (days < 30) return `Synthesized ${Math.floor(days / 7)}w ago`;
  return `Synthesized ${Math.floor(days / 30)}mo ago`;
}

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
  // Timestamps for members synthesized in THIS session, layered over the
  // server-loaded times so re-running immediately picks up the NEXT batch
  // (least-recently-first) rather than repeating the ones just done.
  const [justSynthed, setJustSynthed] = useState<Map<string, number>>(new Map());
  // The exact ordered members of the run in progress, frozen at start. The
  // checklist renders from this so completing a member (which restamps its
  // last-synthesized time) does NOT re-sort the list out from under the run.
  const [runOrder, setRunOrder] = useState<string[]>([]);
  // Snapshot "now" once at mount for the coarse relative last-synthesized labels
  // (today / Nd / Nw / Nmo) so render stays pure and the labels stay stable.
  const [now] = useState(() => Date.now());

  // Effective last-synthesized time: this session's fresh stamp wins over the
  // server-loaded one. Null (never) sorts first so it always gets priority.
  const timeById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of companies) m.set(c.id, justSynthed.get(c.id) ?? c.lastSynthesizedAt);
    return m;
  }, [companies, justSynthed]);
  const orderKey = (id: string) => timeById.get(id) ?? -Infinity;

  // Only members/partners/prospects are offered here (former excluded), ordered
  // least-recently-synthesized first so the top of the list is the most neglected.
  const eligible = useMemo(
    () =>
      companies
        .filter((c) => GROUPS.some((g) => g.match(c.status)))
        .sort(
          (a, b) =>
            orderKey(a.id) - orderKey(b.id) || a.name.localeCompare(b.name),
        ),
    // orderKey reads timeById; both derive from companies + justSynthed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, timeById],
  );
  const nameById = useMemo(
    () => new Map(eligible.map((c) => [c.id, c.name] as const)),
    [eligible],
  );

  // The members that actually run this batch: the selection ordered
  // least-recently-synthesized first, then capped. So when a selection exceeds
  // the cap, the most-neglected members go first and later runs cycle through
  // the rest rather than always repeating the same head.
  const runList = [...selected]
    .sort((a, b) => orderKey(a) - orderKey(b) || nameById.get(a)!.localeCompare(nameById.get(b)!))
    .slice(0, RUN_CAP);
  const overCap = selected.size > RUN_CAP;

  // Once a run has begun, the selection becomes a live checklist: each member
  // shows queued → reading → done/empty/error so the operator can watch the
  // batch march through every one and see a clear tally at the end.
  const started = running || results.size > 0;
  const resultValues = [...results.values()];
  const okCount = resultValues.filter((r) => r.status === "ok").length;
  const errorCount = resultValues.filter((r) => r.status === "error").length;

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
    // Freeze the ordered batch so mid-run restamps can't reshuffle it.
    const order = runList;
    setRunOrder(order);
    setRunning(true);
    setDone(0);
    setResults(new Map());
    for (const [i, id] of order.entries()) {
      const startedAt = Date.now();
      const res = await synthesizeCompany(id);
      setResults((prev) => new Map(prev).set(id, res));
      setDone((d) => d + 1);
      // The server stamps lastSynthesizedAt on any non-error read; mirror it
      // locally so a second run in this session moves on to the next batch.
      if (res.status !== "error") {
        const at = Date.now();
        setJustSynthed((prev) => new Map(prev).set(id, at));
      }
      // Pace the next start under the per-minute AI budget so a big batch never
      // trips the burst cap; skip the wait when the call already took long enough.
      if (i < order.length - 1) {
        const wait = MIN_SPACING_MS - (Date.now() - startedAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
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
          profile updates. Review before anything is saved. This works from what
          Coterie already knows; to pull in new facts, use Enrich on a
          company&apos;s page.
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
                  <span className="ml-auto shrink-0 text-[10px] text-ink-3">
                    {lastSynthLabel(timeById.get(c.id) ?? null, now)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {overCap ? (
          <p className="mt-2 text-[10.5px] text-ink-3">
            Only the first {RUN_CAP} least-recently-synthesized run in this batch
            — run again to continue through the rest.
          </p>
        ) : null}

        {started ? (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium text-ink-2">
              {running
                ? `Synthesizing… ${done} of ${runOrder.length} read`
                : `Finished — read all ${runOrder.length}. ${okCount} ${
                    okCount === 1 ? "profile has" : "profiles have"
                  } proposed updates${
                    errorCount > 0
                      ? `, ${errorCount} could not be read`
                      : ""
                  }.`}
            </p>
            <div className="space-y-3">
              {runOrder.map((id, i) => {
                const name = nameById.get(id) ?? "Member";
                const res = results.get(id);
                if (res)
                  return (
                    <ResultCard
                      key={id}
                      companyId={id}
                      name={name}
                      result={res}
                    />
                  );
                // Not yet in results: the one at index `done` is in flight while
                // running; everything after it is still queued.
                const reading = running && i === done;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded-md border border-line bg-surface px-3.5 py-2.5"
                  >
                    <span className="truncate text-[12px] font-semibold text-ink">
                      {name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10.5px]",
                        reading ? "animate-pulse text-gold" : "text-ink-3",
                      )}
                    >
                      {reading ? "Reading…" : "Queued"}
                    </span>
                  </div>
                );
              })}
            </div>
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
