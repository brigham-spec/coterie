# Affinity — Affinity Wealth Advisors

Live tenant. Provisioned empty; admin invite pending acceptance.

## Identity

| Field | Value |
|---|---|
| Prod Clerk org | `org_3HmNRAFkc54mWEpibxqA7DtpnLS` |
| Prod PG org id | `40ca1b80-a4fa-4b98-9094-20156c3d11b2` |
| orgType | `wealth` (Projects module dropped) |
| Admin | npreddice@affinityadvs.com (org:admin, **invite pending** — must accept email + set password) |

There is ALSO a dev-era Affinity org (`b7ce2777-6472-422e-a68f-5b62e39b6321`,
Clerk `org_3Hk8TmZmkgWPZ5gizyDlRDPg9ek`). It is **inert on prod** and lives in
the dev instance for local testing. Don't confuse it with the live org above.

## Modules

`wealth` = **11 optional modules on, Projects OFF** (revenue, proposals,
commitments, network_search, prospect_finder, news, email, events, meetings,
invoices, value_created) + 5 core.

## Data

- Provisioned **empty** (no data migrated). Starts fresh on first admin sign-in.

## Open items

- **Admin (npreddice@affinityadvs.com) must accept the Clerk invite** before
  anyone can sign in and use the tenant.
- Subject to the cross-client pending migration (see README).

## Provenance

- Provisioned on the live Clerk instance 2026-08-11 via `scripts/create-org.mjs`
  (`--org-type wealth --drop projects`).
