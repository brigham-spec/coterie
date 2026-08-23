import * as Sentry from "@sentry/nextjs";

// Sentry edge-runtime init. The proxy (src/proxy.ts) runs on the edge runtime,
// so errors there are captured by this config rather than the Node.js one.
// Same public DSN as the server config — see sentry.server.config.ts for why
// it's inlined.
Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://08208b2c6fb2f2bd835d0ccc687a0e60@o4511962593230848.ingest.us.sentry.io/4511962610991104",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enabled: process.env.NODE_ENV === "production",
});
