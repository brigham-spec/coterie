# CLAUDE.md — Coterie

## What this project is

Coterie is a multi-tenant Network Management Tool (NMT) for organizations whose core business is managing a network of relationships — economic development corporations, chambers of commerce, and industry councils. First customers: HVEDC, Orange County Chamber, COI, OCP. It is a production rebuild of a validated single-file HTML/JS prototype; the prototype is the design spec, not the codebase. Zero code is reused from it.

The authoritative schema and build order live in `coterie-v1-schema-spec.md` in this repo. Read it before making database or architectural changes. If a change would contradict the spec, stop and ask.

## Stack

- Next.js (App Router) + TypeScript, strict mode, no `any`
- PostgreSQL on Neon, accessed via Prisma
- Clerk for auth (users, organizations, roles)
- Inngest for background jobs (Fireflies sync, scheduled scans)
- Anthropic API for AI features — server-side only, key in env vars, never in client code
- Vercel for hosting

## Cardinal rules (never violate)

1. **Tenant isolation is the product's survival.** Every tenant table carries `org_id`. Every query is scoped to the current org. Postgres row-level security AND application-level scoping — both, always. No feature ships if isolation tests fail.
2. **Sealed silos.** There is NO cross-tenant data visibility of any kind. No sharing flags, no published profiles, no cross-network features. This was an explicit product decision — do not add "flexible" sharing capability speculatively.
3. **Isolation tests run in CI on every change.** Two seeded fake tenants; automated tests assert no query path returns Tenant A data in a Tenant B session.
4. **No secrets in client code.** API keys, OAuth tokens, and credentials live in server environment variables or encrypted database columns only.
5. **Identity is platform-level; data is not.** One human = one Clerk user, potentially belonging to multiple orgs via org_memberships. Each org's data about that person stays inside that org's tenant.

## Key schema decisions (rationale in the spec)

- Companies and contacts are separate tables. Relationship attributes (status, tier, temperature, annual_value) live on the company.
- `status` is a lifecycle field (prospect → member → former), not separate tables. History carries across state changes.
- Introductions are a first-class table with two contact FKs, `source` (manual / detected / ai_suggested), and `outcome`.
- Invoices mirror the QuickBooks model: separate `invoices` and `payments` tables, paid/partial derived from payments, schedules as linked invoices via `parent_invoice_id`, nullable `quickbooks_id` for future sync.
- Action items have polymorphic owners: `owner_user_id` XOR `owner_contact_id` (staff commitments vs. network commitments).
- Meeting↔contact matches record `match_method` and `confidence`; low-confidence matches get surfaced for human confirmation, never silently merged.

## Conventions

- Server components by default; client components only where interactivity requires them
- All money values in dollars (numeric), not thousands
- Dates in the database are UTC; display in America/New_York
- Prisma migrations for every schema change — never edit the database directly
- Commits in imperative mood, small and frequent
- When implementing a build-order item from the spec, complete and test it before starting the next

## Commands

- Node is managed via nvm; `.nvmrc` pins the version (`nvm use` to match).
- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint (enforces `no-explicit-any`)
- `npm run typecheck` — `tsc --noEmit`
- CI runs lint + typecheck + build on every push/PR (`.github/workflows/ci.yml`).
- (Coming with later build-order items: `npm test`, `npx prisma migrate dev`.)

## Current build phase

Foundation (spec §8). Working through items in order:
1. ✅ Repo + Next.js (16, App Router) + TypeScript (strict, no-any) + CI
2. ⬅ NEXT: Clerk + Neon + Prisma schema from spec
3. RLS policies + seeded fake tenants + isolation test suite
4. Core CRUD: companies, contacts, projects, introductions
5. Server-side Anthropic proxy + daily brief
6. Fireflies OAuth + Inngest sync
7. Invoices + payments + revenue view
8. HVEDC demo data migration (spec §6)
9. External security review
10. HVEDC pilot

Update this section as items complete.
