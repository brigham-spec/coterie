import * as Sentry from "@sentry/nextjs";

// Sentry client-side (browser) init. Next loads this automatically for every
// page. Captures unhandled errors in client components and the browser runtime.
// The DSN is public (it necessarily ships in the client bundle) — see
// sentry.server.config.ts for the rationale on inlining it.
Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://08208b2c6fb2f2bd835d0ccc687a0e60@o4511962593230848.ingest.us.sentry.io/4511962610991104",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enabled: process.env.NODE_ENV === "production",
});

// Required by Sentry to instrument Next.js App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
