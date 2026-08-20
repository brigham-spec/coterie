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
// hosts. The PRODUCTION Clerk instance serves its Frontend API from the CNAME
// custom domain `clerk.coterienmt.ai` (NOT the app's own origin, and NOT a
// `/__clerk` proxy), so it must be listed explicitly in script-src/connect-src —
// `'self'` does not cover it. Keep the accounts.dev entries for the dev instance.
// Without the prod domain here, flipping this policy to enforcing would hard-block
// Clerk's SDK + session/org calls (clerk.browser.js, /v1/client, /v1/environment,
// organization_memberships, …) for every user.
const clerkProdFapi = "https://clerk.coterienmt.ai";
const csp = [
  "default-src 'self'",
  // 'unsafe-inline'/'unsafe-eval' are needed by the Next runtime (and dev HMR);
  // report-only keeps them from masking real issues while we tune.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${clerkProdFapi} https://*.clerk.accounts.dev https://challenges.cloudflare.com`,
  `connect-src 'self' ${clerkProdFapi} https://*.clerk.accounts.dev https://clerk-telemetry.com`,
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
