-- AI rate limit — per-org fixed-window counter capping on-demand AI spend
-- (audit L5+). One row per tenant, keyed by org_id (the org owns exactly one
-- budget — no separate uuid PK). Two self-resetting windows (a minute burst
-- window and a daily ceiling); enforceAiRateLimit rolls an elapsed window and
-- refuses once either cap is hit.
--
-- One tenant-scoped table: org_id + RLS. Like unmatched_attendees it references
-- only organizations, so the org_id FK + RLS are the full isolation story. RLS
-- is hand-added at the end (invisible to Prisma's schema diff, exactly like
-- 20260703213500_tenant_rls and 20260709000000_slice_new_connections).

-- CreateTable
CREATE TABLE "ai_rate_limits" (
    "org_id" UUID NOT NULL,
    "minute_window_start" TIMESTAMPTZ(6) NOT NULL,
    "minute_count" INTEGER NOT NULL DEFAULT 0,
    "day_window_start" TIMESTAMPTZ(6) NOT NULL,
    "day_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_rate_limits_pkey" PRIMARY KEY ("org_id")
);

-- AddForeignKey
ALTER TABLE "ai_rate_limits" ADD CONSTRAINT "ai_rate_limits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ai_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_rate_limits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_rate_limits"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
