# HVEDC — Hudson Valley Economic Development Corporation

Pilot tenant. Live in prod, holds the real production data.

## Identity

| Field | Value |
|---|---|
| Prod Clerk org | `org_3HmNBlLsrzxVTj8wtrKX3lAcUKM` |
| Prod PG org id | `f0000000-0000-4000-8000-000000000001` |
| orgType | `edc` (keeps Projects module) |
| Admins | bfarrand@hvedc.com (org:admin); operator (also admin) |

Note: this PG org (`f0000000…`) is the **re-homed data org** — an earlier empty
prod org (`e67d9ebd…`) was deleted and this data-bearing row was re-pointed to
the prod Clerk org. Don't recreate the org.

## Modules

`edc` default = **all 12 optional modules on** + 5 core. Projects kept (the edc
distinction vs wealth).

## Data

- Baseline (pre-import): ~160 companies, 270 contacts, 147 meetings, 23
  introductions, 3 events.
- **2026-08-12:** bulk-imported 131 members via the CSV importer
  (status=`member`) from the 2026 member distribution list. 1 row dropped
  (Amazon — no contact identity). Source transformed from the raw HVEDC CSV
  (fixed encoding, remapped Representative→contact / Business Type→industry,
  first email only per contact). Many rows previewed as "existing" (reused, not
  duplicated) — additive, nothing clobbered.

## Open items

- Multi-email contacts from the import kept only their **first** email; extras
  must be added later via the contact editor's "additional emails" field.
- Subject to the cross-client pending migration (see README) — News / email /
  event-outreach features 500 in prod until `migrate deploy` runs.

## Provenance

- dev→prod Clerk cutover + re-homing done 2026-08-11 (operator re-homed to prod
  Clerk id, data preserved).
