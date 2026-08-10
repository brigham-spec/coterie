import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  backoffDelayMs,
  withAiRetry,
  type BackoffOptions,
} from "@/lib/ai-retry";

// Unit tests for the on-demand AI 429 retry-with-backoff (News audit item 7).
// backoffDelayMs is pure math; withAiRetry retries ONLY a transient 429 with
// exponential backoff, throws any other error immediately, and rethrows the last
// 429 once attempts are exhausted. Timers are faked so the spaced retries run
// instantly.

const opts: BackoffOptions = { attempts: 4, baseMs: 500, maxMs: 8_000 };

function rateLimit() {
  return new Anthropic.RateLimitError(429, undefined, "busy", new Headers());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("backoffDelayMs", () => {
  test("is exponential from baseMs", () => {
    expect(backoffDelayMs(0, opts)).toBe(500);
    expect(backoffDelayMs(1, opts)).toBe(1_000);
    expect(backoffDelayMs(2, opts)).toBe(2_000);
    expect(backoffDelayMs(3, opts)).toBe(4_000);
  });

  test("is capped at maxMs", () => {
    expect(backoffDelayMs(4, opts)).toBe(8_000); // 500·2^4 = 8000 = cap
    expect(backoffDelayMs(10, opts)).toBe(8_000); // would overshoot → clamped
  });
});

describe("withAiRetry", () => {
  test("returns immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withAiRetry(fn, opts)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries a transient 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimit())
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValueOnce("ok");

    const promise = withAiRetry(fn, opts);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("rethrows the last 429 after exhausting every attempt", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(rateLimit());

    const promise = withAiRetry(fn, opts);
    const assertion = expect(promise).rejects.toBeInstanceOf(
      Anthropic.RateLimitError,
    );
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(opts.attempts);
  });

  test("throws a non-429 error immediately without retrying", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Anthropic.AuthenticationError(401, undefined, "no key", new Headers()));

    await expect(withAiRetry(fn, opts)).rejects.toBeInstanceOf(
      Anthropic.AuthenticationError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
