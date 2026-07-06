# Coterie — Internal Security Review (build item 9)

Date: 2026-07-06 · Reviewer: internal audit · Scope: `src/`, Prisma migrations,
`scripts/`, build/env config. Method: source review of the tenant-isolation
mechanism, auth/identity bridge, secret handling, server-action input handling,
raw SQL, XSS surface, dependency advisories, and HTTP hardening.

This is an **internal** review, not a substitute for an external penetration test
before general availability. It covers the code as of commit `1fdd58c` (item 8).

---

## Summary

The application's core security invariant — **sealed tenant silos** — is
implemented with genuine defense in depth and holds up under review. The gaps
found are not tenant-isolation breaks; they are hardening and access-control
items appropriate to close before a wider pilot.

- **Critical:** none.
- **High:** 1 (missing HTTP security headers).
- **Medium:** 3 (no RBAC enforcement; Inngest endpoint hardening + env gap;
  open tenant self-provisioning).
- **Low / informational:** 5.

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

### H1 — Missing HTTP security headers (High)
`next.config.ts` is empty — the app ships no security response headers. Absent:
`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` /
`frame-ancestors` (clickjacking), `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`.
**Impact:** the dashboard can be framed (clickjacking), and there is no CSP to
blunt an XSS should one ever be introduced. No isolation break, but this is the
cheapest high-value hardening available.
**Recommendation:** add a `headers()` block (or middleware) setting the above.
Start CSP in report-only to tune against Clerk's script/frame origins, then
enforce. HSTS with a long max-age once HTTPS-only is confirmed on the domain.

### M2 — Inngest endpoint hardening + env-var documentation gap (Medium)
`/api/inngest` is intentionally outside the Clerk matcher; its authenticity
depends entirely on `INNGEST_SIGNING_KEY` (Inngest verifies request signatures).
Neither `INNGEST_SIGNING_KEY` nor `INNGEST_EVENT_KEY` is listed in
`.env.example`, and `syncFirefliesNow` needs the event key to dispatch.
**Impact:** if deployed without the signing key configured, request-signature
verification is not in force and an attacker who can reach the endpoint could POST
crafted events to invoke functions (which are still `withOrg`-scoped, so no
cross-tenant write — but unwanted job execution and external API calls).
**Recommendation:** document both keys in `.env.example`; make signing-key
presence a startup/deploy requirement; confirm production sets it.

### M1 — No role-based authorization enforcement (Medium)
`requireOrgContext()` resolves a role (`admin` | `staff`) from Clerk's org role,
but **no server action checks it**. Every authenticated org member can void
invoices, disconnect/replace integration credentials, and create/delete records
equally. Horizontal isolation (between orgs) is intact via RLS; what's missing is
the *vertical* privilege distinction the role field implies.
**Impact:** broken-access-control within a tenant if the product intends
admin-only operations (e.g., voiding invoices, managing integrations).
**Recommendation:** decide which actions are admin-only and gate them
(`if (ctx.role !== "admin") throw ...`). If the pilot is intentionally flat,
document that the role field is not yet an authorization boundary.

### M3 — Open tenant self-provisioning (Medium)
`requireOrgContext` JIT-creates an `Organization` the first time it sees any Clerk
org id, trusting Clerk. Any Clerk user who can create/join an org automatically
spins up a live, isolated tenant.
**Impact:** for a controlled pilot this may be undesirable (uncontrolled tenant
creation, unbounded resource/PII footprint).
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

### L5 — No rate limiting on the AI brief action (Low)
`generateBrief` invokes Anthropic on demand with no per-org throttle; a signed-in
user could repeatedly trigger paid calls (cost/abuse).
**Recommendation:** add a simple per-org rate limit / debounce before GA.

---

## Suggested remediation order

1. **H1** — add security headers (quick, high value).
2. **M2** — document + require the Inngest keys; confirm signing key in prod.
3. **M1** — decide and enforce the admin/staff authorization boundary.
4. **M3** — gate tenant self-provisioning for the pilot.
5. **L1/L5** — dependency tracking and AI-brief rate limiting.

None of the above blocks the isolation guarantee; H1 and M1–M3 are the set worth
closing before widening access.
