import * as Sentry from "@sentry/nextjs";

// Next.js calls register() once when a server instance starts (both the Node.js
// and Edge runtimes). We validate the environment here so a misconfigured
// deploy fails at boot with a single clear message rather than midway through a
// request, and load the matching Sentry runtime config so errors get reported.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Only the Node.js runtime carries the full secret set and the Buffer API
    // the validator uses; the Edge runtime (proxy.ts) is skipped.
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    await import("./sentry.server.config");
    return;
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors thrown in nested React Server Components to Sentry.
export const onRequestError = Sentry.captureRequestError;
