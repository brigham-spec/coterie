# Coterie — Reusable Exhaustive Audit Prompt

Paste the block below to an agent that has read access to this repository (via an
MCP filesystem/code server, or Claude Code). It re-runs the full audit and
produces a prioritized findings report. Safe to run anytime — it is READ-ONLY.

---

## THE PROMPT (copy everything between the lines)

────────────────────────────────────────────────────────────────────────────

You are auditing **Coterie**, a production multi-tenant Next.js 16 / React 19 /
TypeScript / Prisma 7 (Postgres via `@prisma/adapter-pg`) / Clerk app. It is a
Network Management Tool for economic-development orgs; tenant data isolation and
correct money math are safety-critical.

**Rules for this audit:**
- READ-ONLY. Do not edit, create, delete, run migrations, or execute writes.
- Cite every finding as `path:line`.
- Rate each finding CRITICAL / HIGH / MEDIUM / LOW / NIT and say *why* it matters
  and the *fix shape* (do not implement it).
- Distinguish a real bug from a policy choice or a naming nit.
- Assume the reader is non-technical for the executive summary; be precise in the
  findings.

Work through these five domains **in parallel where possible**, then produce one
consolidated, severity-sorted report.

### Domain A — Tenant isolation & RLS (highest priority)
1. Confirm `src/lib/tenant.ts::withOrg` sets a transaction-local GUC and that ALL
   tenant-table access goes through it — grep for any tenant model queried on the
   bare `prisma` client (outside `withOrg`). Flag every hit.
2. Inside every `withOrg` callback, confirm queries are SEQUENTIAL awaits, never
   `Promise.all` (one pinned connection). Flag any `Promise.all` inside `withOrg`.
3. In `prisma/schema.prisma` + migrations: verify every tenant table has RLS
   ENABLE **and** FORCE and an identical fail-closed policy
   `org_id = NULLIF(current_setting('app.org_id', true), '')::uuid` in USING and
   WITH CHECK. List any table missing any of these. Confirm `organizations`,
   `users`, `org_memberships` are intentionally unprotected and scoped in auth.
4. Check cross-tenant foreign keys: flag FKs to tenant tables that use a plain id
   instead of a composite `(id, orgId)` where the target exposes `@@unique([id,
   orgId])` and the FK is required (RESTRICT). Note these are defense-in-depth.

### Domain B — Auth & access control
5. Enumerate every `"use server"` file. For each exported action, confirm it calls
   `requireOrgContext()` or `requireAdmin()` before any DB work. Flag any
   unguarded action.
6. Verify destructive/hard-delete actions use `requireAdmin()`. List deletes that
   use only `requireOrgContext()` and label them a POLICY choice (RLS-scoped, not
   an isolation bug).
7. Confirm the platform-admin/operator gate fails closed and is not derivable from
   user-controlled input.
8. Grep for raw SQL (`$executeRaw`/`$queryRaw`); confirm all interpolation is
   parameterized (no string concatenation of user input).

### Domain C — Math correctness
9. Read every pure module under `src/lib/` that does arithmetic (money, dates,
   ratios, percentages, aggregation). For each division, confirm a divide-by-zero
   guard. For each ratio labeled a percentage, confirm numerator/denominator match
   the label. For money, confirm `Prisma.Decimal` is coerced to `number` only at
   aggregation and not compared as strings.
10. For date bucketing on `@db.Date` columns, confirm UTC-calendar boundaries (no
    local-timezone drift).
11. List every pure math module that has NO corresponding `test/*.test.ts` — these
    are untested risk. Especially flag any with a division.

### Domain D — Workflows, idempotency & silent failures
12. For clock/"last contacted" updates, confirm a FORWARD-ONLY guard
    (`OR: [{ field: null }, { field: { lt: <time> } }]`) exists on EVERY write
    path (meetings, Fireflies sync, email threads, quick capture). Flag any path
    missing it.
13. For background jobs (Inngest) and post-sync extraction, confirm failures are
    forwarded to Sentry (not just `console.error`) and that rate-limited/failed
    items are retried, not permanently skipped.
14. For soft-delete/restore, confirm the pre-delete cleanup covers exactly the
    same child records the snapshot captures (no RESTRICT block, no restore-time
    unique violation).
15. For dedupe logic (companies/contacts/imports), confirm normalization
    (`normalizeCompanyName`) is applied consistently.
16. For any concurrent/batch job spending AI budget, confirm row-claiming so two
    runs don't double-process.
17. Confirm owner-XOR and other CHECK constraints are enforced at both the DB and
    the write boundary.

### Domain E — Schema, deploy & config integrity
18. Confirm the app connects as a non-superuser, NOBYPASSRLS role with DML-only
    grants, and that future tables inherit grants (ALTER DEFAULT PRIVILEGES).
19. Confirm `env` validation throws in production on missing/malformed critical
    secrets, and is invoked at boot (`instrumentation.ts`).
20. Confirm the deploy script does NOT silently auto-run migrations, and document
    the intended 2-step migration process. Flag the operational risk of shipping a
    migration-bearing change without the DB step.

### Output format
Produce:
1. A 3–5 sentence **executive summary** (plain language, headline verdict).
2. A **severity-sorted findings table**: ID | Severity | Domain | `file:line` |
   one-line description.
3. For each MEDIUM+ finding: a short paragraph with *why it matters* and the *fix
   shape*.
4. A **"verified clean"** list of the load-bearing modules you confirmed correct.
5. A list of **untested math modules**.

Do not implement anything. Do not modify files.

────────────────────────────────────────────────────────────────────────────

---

## Notes for whoever runs this

- The 2026-08-25 baseline run found **no critical/high issues**; 3 MEDIUM, 8 LOW,
  2 NIT. See `docs/AUDIT-2026-08-25.md`. Compare future runs against that baseline
  to catch regressions.
- If run against **production data** (not just code), keep it read-only: wrap any
  probe in `BEGIN … ROLLBACK` and set `app.org_id` to see exactly what the app
  sees through RLS.
