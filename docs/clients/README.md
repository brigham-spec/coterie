# Client registry

Per-client source of truth for Coterie tenants. **One file per client, kept
current** — edit in place, don't append a log. This directory answers "what is
the state of THIS client right now": org ids, packaging, admins, open
maintenance items, provenance.

## Why per-client tracking is tractable

- **One codebase, one build.** Clients never get forks. Code changes ship to
  everyone at once, gated per-org by module flags.
- **Per-client difference = data, not code.** Which modules a tenant sees is
  `Organization.settings.modules` (a JSON array on the org row), toggled
  operator-only in Settings → Modules. `orgType` (`edc` / `wealth` / …) is the
  packaging default.
- **Isolation = Postgres RLS** on `app.org_id`; every tenant query runs inside
  `withOrg(orgId, tx => …)`. Tenants cannot see each other's rows.

So "change something for HVEDC / Affinity" is almost always a **data/config
change scoped to one org id**, not a code edit. Look up the org id here first.

## Modules

- **Core (always on, 5):** dashboard, companies, contacts, introductions, settings.
- **Optional (12):** revenue, proposals, projects, commitments, network_search,
  prospect_finder, news, email, events, meetings, invoices, value_created.
- `edc` default = all 12 on. `wealth` default = 11 on (projects dropped).
- Registry stored in `Organization.settings.modules`; absent = all-on.
- Only the platform operator (`PLATFORM_ADMIN_EMAILS`) can change packaging.

## Environments

| | Prod | Dev / local |
|---|---|---|
| Clerk | `pk_live`, frontend `clerk.coterienmt.ai` | `pk_test`, accounts.dev |
| App URL | app.coterienmt.ai | localhost |
| Database | Neon `neondb` | Neon `coterie_dev` (same endpoint, separate db) |

- **Operator / platform admin:** the human in `PLATFORM_ADMIN_EMAILS` (Vercel
  prod env). Only the operator toggles module packaging.
- **Deploy is code-only.** `next build` does NOT run `prisma migrate deploy`.
  Migrations are run deliberately against `DIRECT_URL` — ASK before touching prod.

## Per-client file template

```
# <Client> — <full name>
## Identity     — Prod Clerk org id, Prod PG org id, orgType, admins
## Modules      — enabled optional set (or "orgType default")
## Data         — baseline counts, notable imports/migrations
## Open items   — pending maintenance, follow-ups
## Provenance   — how/when provisioned, cutovers, references
```

## Clients

- [HVEDC](./hvedc.md) — Hudson Valley Economic Development Corp (pilot, live, has data)
- [Affinity](./affinity.md) — Affinity Wealth Advisors (live, admin invite pending)

## Open cross-client items

- **Pending migration `20260811215927_sync_schema_drift` is UNAPPLIED to prod
  `neondb`.** News key-facts / email done-items / event-outreach features 500 in
  prod until `prisma migrate deploy` runs against prod (additive/safe — ASK first).
