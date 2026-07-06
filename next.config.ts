import type { NextConfig } from "next";

// Security review item H1 (docs/security-review.md). The app shipped no HTTP
// security headers; these add clickjacking/MIME/referrer hardening on every
// response plus a Content-Security-Policy in REPORT-ONLY mode.
//
// Why report-only for CSP: an enforcing policy can silently break Clerk's
// script/frame/telemetry origins and Next's inline runtime. Report-only lets us
// observe violations (via the browser console / a future report endpoint) and
// tune the allowlist against the real Clerk instance before flipping to
// enforcing `Content-Security-Policy`. The other headers are safe to enforce now.
//
// The Clerk origins below cover the development instance (`*.clerk.accounts.dev`)
// and Clerk's bot-protection (`challenges.cloudflare.com`) + image/telemetry
// hosts. A production Clerk instance serves its Frontend API from the app's own
// domain via the `/__clerk` proxy (see src/proxy.ts), so `'self'` already covers
// it; keep the accounts.dev entries for the dev instance.
const csp = [
  "default-src 'self'",
  // 'unsafe-inline'/'unsafe-eval' are needed by the Next runtime (and dev HMR);
  // report-only keeps them from masking real issues while we tune.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com",
  "img-src 'self' data: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
