-- Sync-status card (gap-audit cluster B): record when each integration last
-- completed a sync so the dashboard can report freshness. Nullable — existing
-- rows and never-synced integrations read as "never synced". No RLS change: the
-- table already carries tenant_isolation (ENABLE/FORCE) from slice 11.0.
ALTER TABLE "integration_credentials" ADD COLUMN "last_synced_at" TIMESTAMPTZ;
