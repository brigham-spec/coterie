"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { Button, Card, CardHeader, cn } from "@/components/ui";
import type { IntroSuggestion, ProactivePairing } from "@/lib/intro-engine";
import type { RoleCandidate } from "@/lib/open-roles-engine";

import {
  dismissIntro,
  suggestIntros,
  type IntroSuggestState,
} from "../companies/[id]/actions";
import { scanNetworkIntros, type ProactiveScanState } from "../actions";
import { scanOpenRole, type OpenRoleScanState } from "../projects/actions";

// Unified Introduction Engine (gap-audit follow-up). The prototype's flagship
// module (Coterie.html:14566) is one destination with three matching modes; the
// production build had the same reasoning but scattered onto the dashboard and
// company/project profiles. This client shell reassembles them over the SAME
// server actions (suggestIntros / scanOpenRole / scanNetworkIntros), so the
// Anthropic key never crosses to the browser and every result stays ephemeral —
// nothing is written until an intro is logged in the ledger below.

export type EngineMember = { id: string; name: string; status: string };
export type EngineProject = {
  id: string;
  name: string;
  stage: string;
  county: string | null;
  openRoles: { value: string; label: string }[];
};

type Mode = "member" | "catalyst" | "network";

const MODES: { key: Mode; label: string; blurb: string }[] = [
  {
    key: "member",
    label: "For a Member",
    blurb:
      "Pick a member or prospect and surface who in the network they should meet, and why.",
  },
  {
    key: "catalyst",
    label: "Project Catalyst",
    blurb:
      "Staff an unfilled role on an active project with the best-fit companies in the network.",
  },
  {
    key: "network",
    label: "Network Scan",
    blurb:
      "Scan the whole network for the highest-value introductions to make right now.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  member: "Member",
  strategic_partner: "Partner",
  prospect: "Prospect",
};

export function IntroEngine({
  members,
  projects,
}: {
  members: EngineMember[];
  projects: EngineProject[];
}) {
  const [mode, setMode] = useState<Mode>("member");
  const active = MODES.find((m) => m.key === mode) ?? MODES[0];

  return (
    <Card>
      <CardHeader title="Introduction engine" />
      <div className="p-4">
        <div className="mb-3 grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const on = m.key === mode;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={cn(
                  "rounded-md border px-3 py-2 text-[11.5px] font-medium transition-colors",
                  on
                    ? "border-gold-line bg-gold-bg text-gold-ink"
                    : "border-line bg-surface-2 text-ink-2 hover:border-gold-line hover:text-gold",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mb-4 text-[11px] text-ink-3">{active.blurb}</p>

        {mode === "member" ? (
          <MemberMode members={members} />
        ) : mode === "catalyst" ? (
          <CatalystMode projects={projects} />
        ) : (
          <NetworkMode />
        )}
      </div>
    </Card>
  );
}

// ── For a Member ──────────────────────────────────────────────────────────────
function MemberMode({ members }: { members: EngineMember[] }) {
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [result, setResult] = useState<IntroSuggestState>({ status: "idle" });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, query]);

  const focus = members.find((m) => m.id === focusId) ?? null;

  function run(id: string) {
    setFocusId(id);
    setResult({ status: "idle" });
    setDismissed(new Set());
    startTransition(async () => {
      const fd = new FormData();
      fd.set("companyId", id);
      setResult(await suggestIntros({ status: "idle" }, fd));
    });
  }

  function dismiss(candidateId: string) {
    if (focusId == null) return;
    setDismissed((prev) => new Set(prev).add(candidateId));
    const focus = focusId;
    startTransition(async () => {
      await dismissIntro(focus, candidateId);
    });
  }

  if (members.length === 0) {
    return (
      <p className="text-[11px] text-ink-3 italic">
        Add members or prospects to find their best connections.
      </p>
    );
  }

  const visible =
    result.status === "ok"
      ? result.suggestions.filter((s) => !dismissed.has(s.companyId))
      : [];

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter members and prospects…"
        className="mb-2 w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-line"
      />
      <div className="max-h-48 overflow-y-auto rounded-sm border border-line">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-ink-3">No matches.</p>
        ) : (
          filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => run(m.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-left text-[11.5px] transition-colors last:border-b-0 hover:bg-surface-2",
                m.id === focusId ? "bg-gold-bg/40 text-gold-ink" : "text-ink-2",
              )}
            >
              <span className="truncate">{m.name}</span>
              <span className="shrink-0 text-[9px] tracking-[0.06em] text-ink-3 uppercase">
                {STATUS_LABEL[m.status] ?? m.status}
              </span>
            </button>
          ))
        )}
      </div>

      {focus ? (
        <div className="mt-4">
          <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
            Connections for {focus.name}
          </div>
          {pending && result.status === "idle" ? (
            <p className="text-[11px] text-ink-3 italic">Reading the network…</p>
          ) : result.status === "error" ? (
            <p className="text-[11px] text-red-ink">{result.message}</p>
          ) : result.status === "ok" ? (
            visible.length === 0 ? (
              <p className="text-[11px] text-ink-3 italic">
                No strong introductions surfaced from the current network.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {visible.map((s) => (
                  <SuggestionCard key={s.companyId} s={s} onDismiss={dismiss} />
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionCard({
  s,
  onDismiss,
}: {
  s: IntroSuggestion;
  onDismiss: (candidateId: string) => void;
}) {
  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/companies/${s.companyId}`}
            className="font-medium text-ink hover:underline"
          >
            {s.companyName}
          </Link>
          <div className="mt-0.5 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
            {s.connectionType}
          </div>
        </div>
        <ScorePill score={s.score} />
      </div>
      <p className="mt-2 text-[11.5px] font-medium text-ink-2">{s.headline}</p>
      <p className="mt-1 text-[11.5px] text-ink-2">{s.whatItAdvances}</p>
      <p className="mt-1 text-[11px] text-ink-3 italic">{s.whyNow}</p>
      {s.talkingPoints.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {s.talkingPoints.map((t, i) => (
            <li key={i} className="text-[11px] text-ink-2">
              · {t}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button type="button" onClick={() => onDismiss(s.companyId)}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

// ── Project Catalyst (open roles) ─────────────────────────────────────────────
const FIT_LABEL: Record<number, string> = { 5: "Strong", 4: "Good", 3: "Possible" };

function CatalystMode({ projects }: { projects: EngineProject[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<{ projectId: string; role: string } | null>(
    null,
  );
  const [result, setResult] = useState<OpenRoleScanState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.county ?? "").toLowerCase().includes(q),
    );
  }, [projects, query]);

  function run(projectId: string, role: string) {
    setActive({ projectId, role });
    setResult({ status: "idle" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("role", role);
      setResult(await scanOpenRole({ status: "idle" }, fd));
    });
  }

  if (projects.length === 0) {
    return (
      <p className="text-[11px] text-ink-3 italic">
        No active projects with open team roles. Add a project and leave a
        discipline unstaffed to see candidate matches here.
      </p>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter projects…"
        className="mb-2 w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-line"
      />
      <div className="flex flex-col gap-2.5">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-ink-3">No matches.</p>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-line bg-surface-2 px-3.5 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/dashboard/projects/${p.id}`}
                  className="text-[12.5px] font-semibold text-ink hover:underline"
                >
                  {p.name}
                </Link>
                <span className="shrink-0 text-[10px] text-ink-3">
                  {labelize(p.stage)}
                  {p.county ? ` · ${p.county}` : ""}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.openRoles.map((r) => {
                  const on =
                    active?.projectId === p.id && active.role === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => run(p.id, r.value)}
                      disabled={pending}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[10.5px] transition-colors disabled:opacity-50",
                        on
                          ? "border-gold-line bg-gold-bg text-gold-ink"
                          : "border-line bg-surface text-ink-2 hover:border-gold-line hover:text-gold",
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {active ? (
        <div className="mt-4">
          {pending && result.status === "idle" ? (
            <p className="text-[11px] text-ink-3 italic">Scanning the network…</p>
          ) : result.status === "error" ? (
            <p className="text-[11px] text-red-ink">{result.message}</p>
          ) : result.status === "ok" ? (
            <>
              <div className="mb-2 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
                Best fits — {result.roleLabel}
              </div>
              {result.candidates.length === 0 ? (
                <p className="text-[11px] text-ink-3 italic">
                  No suitable candidates surfaced for this role right now.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {result.candidates.map((c) => (
                    <CandidateCard key={c.companyId} c={c} />
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CandidateCard({ c }: { c: RoleCandidate }) {
  return (
    <li className="rounded-md border border-line bg-surface px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/dashboard/companies/${c.companyId}`}
          className="min-w-0 text-[11.5px] font-semibold text-ink hover:underline"
        >
          {c.companyName}
        </Link>
        <span className="shrink-0 rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold">
          {FIT_LABEL[c.score] ?? `${c.score}/5`}
        </span>
      </div>
      {c.whyFit ? <p className="mt-1.5 text-[11px] text-ink-2">{c.whyFit}</p> : null}
      {c.concern ? (
        <p className="mt-1 text-[10.5px] text-ink-3 italic">Concern: {c.concern}</p>
      ) : null}
    </li>
  );
}

// ── Network Scan ──────────────────────────────────────────────────────────────
function NetworkMode() {
  const [result, setResult] = useState<ProactiveScanState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setResult(await scanNetworkIntros({ status: "idle" }, new FormData()));
    });
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button type="button" variant="gold" disabled={pending} onClick={run}>
          {pending
            ? "Scanning…"
            : result.status === "ok"
              ? "Rescan network"
              : "Scan network"}
        </Button>
      </div>
      {pending ? (
        <p className="text-[11px] text-ink-3 italic">Reading the network…</p>
      ) : result.status === "error" ? (
        <p className="text-[11px] text-red-ink">{result.message}</p>
      ) : result.status === "ok" ? (
        result.pairings.length === 0 ? (
          <p className="text-[11px] text-ink-3 italic">
            No new introductions surfaced right now.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.pairings.map((p) => (
              <PairingCard key={`${p.companyAId}|${p.companyBId}`} p={p} />
            ))}
          </ul>
        )
      ) : (
        <p className="text-[11px] text-ink-3">
          Scan the network for the highest-value pairs to connect right now.
        </p>
      )}
    </div>
  );
}

function PairingCard({ p }: { p: ProactivePairing }) {
  return (
    <li className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[11.5px] font-semibold text-ink">
          <Link
            href={`/dashboard/companies/${p.companyAId}`}
            className="hover:underline"
          >
            {p.companyAName}
          </Link>{" "}
          <span className="text-ink-3">&#8596;</span>{" "}
          <Link
            href={`/dashboard/companies/${p.companyBId}`}
            className="hover:underline"
          >
            {p.companyBName}
          </Link>
        </div>
        <ScorePill score={p.score} />
      </div>
      {p.connectionType ? (
        <div className="mt-0.5 text-[9.5px] tracking-[0.06em] text-ink-3 uppercase">
          {p.connectionType}
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] font-medium text-ink-2">{p.headline}</p>
      {p.whyNow ? (
        <p className="mt-1 text-[10.5px] text-ink-3 italic">{p.whyNow}</p>
      ) : null}
      {p.talkingPoints.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {p.talkingPoints.map((t, i) => (
            <li key={i} className="text-[10.5px] text-ink-2">
              · {t}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────
function ScorePill({ score }: { score: number }) {
  return (
    <span className="shrink-0 rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[11px] font-medium text-gold">
      {score}/5
    </span>
  );
}

function labelize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
