import * as Sentry from "@sentry/nextjs";

// Sentry server-side init (Node.js runtime). Loaded from instrumentation.ts on
// server start. Captures unhandled errors in server components, route handlers,
// server actions, and background code so failures reach us by email instead of
// being discovered reactively.
//
// The DSN is a public identifier (it also ships in the client bundle) — not a
// secret — so it's inlined to avoid an extra env-var setup step. An env var
// still wins if set, which lets a different Sentry project be used per
// environment without a code change.
Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://08208b2c6fb2f2bd835d0ccc687a0e60@o4511962593230848.ingest.us.sentry.io/4511962610991104",
  // Error monitoring is the priority; keep performance tracing light so a
  // low-traffic pilot doesn't burn the free-tier quota. Raise later if needed.
  tracesSampleRate: 0.1,
  // This is a CRM — don't attach request bodies / user PII to events by default.
  sendDefaultPii: false,
  enabled: process.env.NODE_ENV === "production",
});
