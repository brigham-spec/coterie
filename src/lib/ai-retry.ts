import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Retry an on-demand AI call through a transient 429 with exponential backoff
// (News audit item 7). The Anthropic SDK already retries a couple of times, but
// a busy web_search scan can still surface a RateLimitError; a few more spaced
// attempts let a momentary spike self-heal before the caller's handler falls
// back to "AI is busy right now". Only 429s are retried — auth/bad-request
// errors throw immediately — and the final 429 rethrows unchanged so existing
// catch blocks keep surfacing the same inline message.

export interface BackoffOptions {
  attempts: number; // total tries, including the first
  baseMs: number; // delay before the first retry
  maxMs: number; // per-delay ceiling
}

export const DEFAULT_AI_BACKOFF: BackoffOptions = {
  attempts: 4,
  baseMs: 500,
  maxMs: 8_000,
};

// PURE: the delay before the retry that follows a zero-based attempt index.
// Exponential (baseMs · 2^index) capped at maxMs — index 0 → baseMs, 1 → 2·base…
export function backoffDelayMs(attemptIndex: number, opts: BackoffOptions): number {
  return Math.min(opts.baseMs * 2 ** attemptIndex, opts.maxMs);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Run `fn`, retrying only on a transient 429 with exponential backoff between
// attempts. Any other error throws immediately; the last 429 rethrows after the
// final attempt so the caller's existing handling is unchanged.
export async function withAiRetry<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = DEFAULT_AI_BACKOFF,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof Anthropic.RateLimitError)) throw err;
      lastErr = err;
      if (i < opts.attempts - 1) await sleep(backoffDelayMs(i, opts));
    }
  }
  throw lastErr;
}
