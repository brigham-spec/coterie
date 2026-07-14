import type { Prisma } from "@/generated/prisma/client";

import { getStageDef, type StageTone } from "./project-stages";

// Pure reader for a project's stage_history JSON (the trail updateStage appends to,
// each entry `{ stage, date: "YYYY-MM-DD", ts }`). Turns it into an ordered timeline
// with the days spent in each stage — the span to the next transition, or to `now`
// for the stage the project is currently in. No DB, no I/O: fully unit-testable, the
// counterpart to the project detail page's read.

export type StageTimelineEntry = {
  stage: string;
  label: string;
  tone: StageTone;
  date: string;
  days: number;
  isCurrent: boolean;
};

// Parse a "YYYY-MM-DD" date to a UTC day count. Pinning to UTC keeps day math free
// of the server's local-timezone drift (a transition dated today must read as 0
// days, never -1/+1). Returns null for anything that isn't a valid calendar date.
function toUtcDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(ms);
  // Reject overflowed components (e.g. month 13, day 32 rolling forward).
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() !== Number(mo) - 1 ||
    back.getUTCDate() !== Number(d)
  )
    return null;
  return ms;
}

const DAY_MS = 86_400_000;

export function buildStageTimeline(
  stageHistory: Prisma.JsonValue | null | undefined,
  now: Date = new Date(),
): StageTimelineEntry[] {
  if (!Array.isArray(stageHistory)) return [];

  const parsed = stageHistory
    .map((raw) => {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw))
        return null;
      const rec = raw as Record<string, unknown>;
      const stage = rec.stage;
      const date = rec.date;
      if (typeof stage !== "string" || typeof date !== "string") return null;
      const day = toUtcDay(date);
      if (day === null) return null;
      return { stage, date, day };
    })
    .filter((e): e is { stage: string; date: string; day: number } => e !== null)
    .sort((a, b) => a.day - b.day);

  if (parsed.length === 0) return [];

  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return parsed.map((e, i) => {
    const def = getStageDef(e.stage);
    const isCurrent = i === parsed.length - 1;
    const end = isCurrent ? nowDay : parsed[i + 1].day;
    const days = Math.max(0, Math.round((end - e.day) / DAY_MS));
    return {
      stage: e.stage,
      label: def.label,
      tone: def.tone,
      date: e.date,
      days,
      isCurrent,
    };
  });
}
