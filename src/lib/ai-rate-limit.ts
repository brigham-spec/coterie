import "server-only";

import { withOrg } from "@/lib/tenant";

// Per-org AI rate limit (audit L5+). Every on-demand AI seam is a paid Anthropic
// call any signed-in user can trigger; without a ceiling a single tenant could
// run up unbounded spend. This caps each org to a short burst (per minute) and a
// daily total via two self-resetting fixed windows. The window/cap arithmetic is
// a PURE function (unit-tested); enforceAiRateLimit wires it to the RLS-scoped
// counter row and throws AiRateLimitError when a cap is hit. A permitted call
// bumps both counts — the model call is what costs money, so an attempt counts
// whether or not the model then succeeds.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// Pilot defaults: 20 calls/minute absorbs normal interactive bursts; 300/day is
// a generous ceiling for a staffed org while still bounding runaway spend.
export const DEFAULT_CAPS: RateCaps = {
  minuteCap: 20,
  minuteMs: MINUTE_MS,
  dayCap: 300,
  dayMs: DAY_MS,
};

export interface RateCaps {
  minuteCap: number;
  minuteMs: number;
  dayCap: number;
  dayMs: number;
}

export interface RateWindows {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
}

export interface RateDecision {
  allowed: boolean;
  next: RateWindows;
}

// Thrown by enforceAiRateLimit when the caller is over a cap. AI actions catch it
// and render the message inline, mirroring their Anthropic error handling.
export class AiRateLimitError extends Error {
  constructor(
    message = "AI usage limit reached. Please wait a moment and try again.",
  ) {
    super(message);
    this.name = "AiRateLimitError";
  }
}

// Pure fixed-window evaluation. Rolls any window whose start has elapsed, then —
// if both windows are under cap — records the call by incrementing both counts.
// When over cap the counts are left untouched (the call is refused, not counted).
// `current` is null for an org that has never made an AI call.
export function evaluateRateLimit(
  current: RateWindows | null,
  nowMs: number,
  caps: RateCaps,
): RateDecision {
  let minuteStart = current?.minuteStart ?? nowMs;
  let minuteCount = current?.minuteCount ?? 0;
  let dayStart = current?.dayStart ?? nowMs;
  let dayCount = current?.dayCount ?? 0;

  if (nowMs - minuteStart >= caps.minuteMs) {
    minuteStart = nowMs;
    minuteCount = 0;
  }
  if (nowMs - dayStart >= caps.dayMs) {
    dayStart = nowMs;
    dayCount = 0;
  }

  const allowed = minuteCount < caps.minuteCap && dayCount < caps.dayCap;
  if (allowed) {
    minuteCount += 1;
    dayCount += 1;
  }

  return { allowed, next: { minuteStart, minuteCount, dayStart, dayCount } };
}

// Charge one AI call against the org's budget, or refuse. Loads the counter row
// RLS-scoped (a tenant only sees its own), applies the pure evaluation, and — only
// when allowed — persists the incremented windows. Over cap: nothing is written
// and AiRateLimitError is thrown. Call this immediately before the paid seam.
export async function enforceAiRateLimit(
  orgId: string,
  caps: RateCaps = DEFAULT_CAPS,
): Promise<void> {
  const decision = await withOrg(orgId, async (tx) => {
    // Serialize concurrent charges for THIS org so the read-modify-write below is
    // atomic. Without it two simultaneous calls both read the same count and both
    // write count+1, silently losing an increment and letting the cap be exceeded.
    // A transaction-scoped advisory lock keyed on the org auto-releases at commit
    // and never blocks a different tenant (distinct key → no contention).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;

    const row = await tx.aiRateLimit.findUnique({ where: { orgId } });
    const current: RateWindows | null = row
      ? {
          minuteStart: row.minuteWindowStart.getTime(),
          minuteCount: row.minuteCount,
          dayStart: row.dayWindowStart.getTime(),
          dayCount: row.dayCount,
        }
      : null;

    const result = evaluateRateLimit(current, Date.now(), caps);
    if (!result.allowed) return result;

    const data = {
      minuteWindowStart: new Date(result.next.minuteStart),
      minuteCount: result.next.minuteCount,
      dayWindowStart: new Date(result.next.dayStart),
      dayCount: result.next.dayCount,
    };
    await tx.aiRateLimit.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    return result;
  });

  if (!decision.allowed) throw new AiRateLimitError();
}
