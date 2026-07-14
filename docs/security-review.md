# Coterie — Internal Security Review (build item 9)

Date: 2026-07-06 · Reviewer: internal audit · Scope: `src/`, Prisma migrations,
`scripts/`, build/env config. Method: source review of the tenant-isolation
mechanism, auth/identity bridge, secret handling, server-action input handling,
raw SQL, XSS surface, dependency advisories, and HTTP hardening.

This is an **internal** review, not a substitute for an external penetration test
before general availability. It covers the code as of commit `1fdd58c` (item 8).

**Status reconciled 2026-07-14 (v2).** Every *actionable* finding has been closed;
what remains are the two pilot-scoped access-control decisions (M1, M3) that are
deliberately accepted until access widens. Closed since the original review:
**H1** (security headers — `next.config.ts` ships CSP-report-only + HSTS +
X-Frame-Options DENY + nosniff + Referrer-Policy + Permissions-Policy),
**M2** (Inngest keys documented in `.env.example`; the route asserts
`INNGEST_SIGNING_KEY` in prod — see the v6 audit batch), and **L5** (per-org AI
rate limiting via `src/lib/ai-rate-limit.ts`, 20/min + 300/day, across every
on-demand paid seam). No open build items remain in this review.

---

## Summary

The application's core security invariant — **sealed tenant silos** — is
implemented with genuine defense in depth and holds up under review. The gaps
found are not tenant-isolation breaks; they are hardening and access-control
items appropriate to close before a wider pilot.

- **Critical:** none.
- **High:** 1 (missing HTTP security headers) — ✅ CLOSED (H1).
- **Medium:** 3 — M2 (Inngest hardening + env) ✅ CLOSED; M1 (no RBAC) and
  M3 (open self-provisioning) **ACCEPTED for pilot**, revisit before wider access.
- **Low / informational:** 5 — L5 (AI rate limiting) ✅ CLOSED; rest tracked.

---

## What's working well (verified, no action needed)

- **Tenant isolation is layered and consistent.** Postgres RLS is
  `ENABLE`d **and** `FORCE`d on all 13 tenant tables with a single
  `tenant_isolation` policy keyed to the tx-local GUC `app.org_id`
  (`NULLIF(current_setting(...),'')` → unset GUC yields NULL → **fail closed**),
  on both `USING` and `WITH CHECK`. `FORCE` is essential because the app connects
  as the table owner. (`prisma/migrations/*_tenant_rls`.)
- **`withOrg` is the only sanctioned path to tenant data.** It opens a
  transaction and sets `app.org_id` with `set_config(..., true)` — **transaction-
  local**, so the setting cannot leak across requests sharing a pooled connection.
  The value is **parameter-bound** (`${orgId}` via Prisma tagged template), not
  interpolated. (`src/lib/tenant.ts`.)
- **Two-role DB model enforces RLS at runtime.** `app_user` is `LOGIN
  NOBYPASSRLS` with **DML-only** grants (no DDL, no superuser); the owner role is
  used only for migrations/admin. Neon's owner has `BYPASSRLS`, which would make
  RLS inert — this split is what keeps it live. (`scripts/bootstrap-app-role.mjs`.)
- **`org_id` is always stamped from server context, never from client input**,
  across every create action; RLS `WITH CHECK` backstops it.
- **Plain-FK cross-tenant risk is correctly closed at the app layer.** Where a
  tenant table has a *plain* FK to another tenant table (contacts→company,
  introductions→contacts/project, invoices→company, payments→invoice), each action
  re-loads the parent **inside the same `withOrg` tx** so a foreign id resolves
  null and is refused — because Postgres FK checks bypass RLS. Where the FK is
  *composite* (`project_links`), the DB refuses cross-org links structurally.
- **Secrets handled correctly.** Integration tokens are encrypted with
  AES-256-GCM (confidentiality + integrity; tampered ciphertext throws) so the DB
  only ever stores ciphertext (`src/lib/crypto.ts`, `src/lib/integrations.ts`).
  The Anthropic key, crypto, Fireflies transport, and the identity bridge are all
  behind `import "server-only"` seams and never reach the browser.
- **No injection or XSS sinks found.** The only raw SQL in app code is the
  parameterized `set_config`. No `queryRawUnsafe`/`executeRawUnsafe`. No
  `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` anywhere in
  `src/`. AI/model output is rendered as React text (`_brief.tsx`), not HTML.
- **Env hygiene.** `.env*` is gitignored (only `.env.example` is tracked, and it
  contains placeholders, no real secrets); `*.pem` is ignored; no secret-bearing
  files are tracked.
- **Route protection.** Clerk `proxy.ts` guards `/dashboard(.*)` with
  `auth.protect()`; unauthenticated requests redirect to sign-in.

---

## Findings

### H1 — Missing HTTP security headers (High) — ✅ CLOSED (2026-07-14)
Originally `next.config.ts` shipped no security response headers.
**Resolution:** `next.config.ts` now serves a `headers()` block on `/:path*`:
`Content-Security-Policy-Report-Only` (tuned for Clerk's script/frame/telemetry
origins, report-only so it can be observed before enforcing), `Strict-Transport-
Security` (max-age 2y, includeSubDomains, preload), `X-Frame-Options: DENY` +
CSP `frame-ancestors 'none'` (clickjacking), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`
(camera/microphone/geolocation/browsing-topics off). **Remaining follow-up (not
a gap):** flip CSP from report-only to enforcing once violations are observed
clean against the production Clerk instance.

### M2 — Inngest endpoint hardening + env-var documentation gap (Medium) — ✅ CLOSED (2026-07-14)
Originally neither Inngest key was documented and the route did not require one.
**Resolution:** both `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are now
documented in `.env.example` with the "required in production" rationale, and the
`/api/inngest` route asserts `INNGEST_SIGNING_KEY` at boot in production (skipped
only during the Next build phase) — see the v6 audit batch. Deploy without the
signing key fails fast instead of serving an unverifiable endpoint.
**Follow-up (ops, not code):** confirm the signing key is set in the production
Inngest/deploy environment.

### M1 — No role-based authorization enforcement (Medium) — ACCEPTED (flat for pilot)
`requireOrgContext()` resolves a role (`admin` | `staff`) from Clerk's org role,
but **no server action checks it**. Every authenticated org member can void
invoices, disconnect/replace integration credentials, and create/delete records
equally. Horizontal isolation (between orgs) is intact via RLS; what's missing is
the *vertical* privilege distinction the role field implies.
**Impact:** broken-access-control within a tenant if the product intends
admin-only operations (e.g., voiding invoices, managing integrations).
**Decision (2026-07-06):** for the HVEDC pilot, access is intentionally **flat** —
every org member has equal permissions. Pilot orgs are small, trusted teams, so
the mistake/blast-radius risk is accepted. The `role` field (admin/staff) is
resolved and stored but is **NOT yet an authorization boundary**. Revisit before
broader/less-trusted access: gate sensitive actions with
`if (ctx.role !== "admin") throw ...` (candidates: void invoice, connect/disconnect
integrations, destructive deletes).

### M3 — Open tenant self-provisioning (Medium) — ACCEPTED (open, gated by Clerk sign-up)
`requireOrgContext` JIT-creates an `Organization` the first time it sees any Clerk
org id, trusting Clerk. Any Clerk user who can create/join an org automatically
spins up a live, isolated tenant.
**Impact:** for a controlled pilot this may be undesirable (uncontrolled tenant
creation, unbounded resource/PII footprint).
**Decision (2026-07-06):** leave app-side provisioning **open** for the pilot. The
effective gate is upstream in Clerk — who can create an account + an org. This is
acceptable ONLY while Clerk sign-up is restricted (invite-only / not public). If
Clerk sign-up is ever opened to the public, revisit: add an allowlist check before
`provisionOrg` creates a row, or restrict org creation to admins in Clerk. Action:
confirm the Clerk dashboard Sign-up + Organizations settings match this intent.
**Recommendation:** gate org creation in the Clerk dashboard (admin-created orgs
only) or add an allowlist check before `provisionOrg` creates a row.

### L1 — Dependency advisories, build-time only (Low)
`npm audit` reports 5 moderate advisories: `postcss <8.5.10` (CSS-stringify XSS)
and `prisma`/`@prisma/dev` transitive. All are **build/dev-time tooling**, not
runtime-reachable in the deployed server.
**Recommendation:** track and bump when non-breaking fixes are available. Do
**not** run `npm audit fix --force` — it wants to downgrade `next` to 9.x.

### L2 — Platform tables have no RLS (informational, by design)
`organizations` / `users` / `org_memberships` carry no RLS (cardinal rule #5 —
identity is shared across orgs), and `app_user` has DML on them. They rely purely
on app-layer scoping (lookups by Clerk id / membership). Acceptable, but any
future code touching them has **no DB backstop** — such queries must scope
explicitly.

### L3 — Server-action error strings (informational)
Actions throw messages like `"company not found in this organization"`. Next.js
redacts uncaught server-action errors in production (digest only), so these do not
leak to the client in prod. Confirm `NODE_ENV=production` in the deployment.

### L4 — HVEDC demo seed org holds PII in the production DB (informational)
Item 8 loaded real-ish company/contact PII into a seed org with `clerkId = null`.
It is isolated by RLS and unreachable by any Clerk session (no org maps to it), so
this is not an exposure — but confirm it's intended for the pilot, and treat
linking a Clerk org to it as a deliberate, audited step.

### L5 — No rate limiting on the AI brief action (Low) — ✅ CLOSED
`generateBrief` and every other on-demand paid seam now go through
`enforceAiRateLimit(orgId)` (`src/lib/ai-rate-limit.ts`, 20/min + 300/day per org,
with a tx-scoped advisory lock closing the check-then-write race — see the v6
audit batch). Repeated triggering is throttled per tenant.

---

## Suggested remediation order

1. ~~**H1** — add security headers~~ ✅ CLOSED.
2. ~~**M2** — document + require the Inngest keys~~ ✅ CLOSED (confirm the key is
   set in the prod environment — ops step).
3. **M1** — decide and enforce the admin/staff authorization boundary.
   **Deferred (flat for pilot).** The highest-value item to build before widening
   access: gate sensitive actions on `ctx.role === "admin"` (candidates: void
   invoice, connect/disconnect integrations, destructive deletes).
4. **M3** — gate tenant self-provisioning. **Deferred (open for pilot).** Effective
   gate is upstream in Clerk (invite-only sign-up); add an allowlist before
   `provisionOrg` if public sign-up is ever enabled.
5. ~~**L5** — AI-brief rate limiting~~ ✅ CLOSED. **L1** — dependency advisories
   remain build/dev-time only; bump when non-breaking fixes land.

None of the above blocks the isolation guarantee. With H1/M2/L5 closed, the only
open items are the two pilot-scoped access decisions (M1, M3), to revisit before
widening beyond the trusted pilot.
