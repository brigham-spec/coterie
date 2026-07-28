-- Proactive-scan cache — per-(org, scope) snapshot of the last network intro scan
-- (audit item 13, the prototype's PROACTIVE_INTROS_KEY / saveProactiveIntros). Lets
-- the Urgent Signals panel render instantly from cache and only re-fire the AI scan
-- once the snapshot is stale (isProactiveCacheFresh, 4h TTL). Keyed by (org_id, scope)
-- — one cached scan per scope (members | full). pairings is the ProactivePairing[]
-- payload stored verbatim as JSON and re-validated on read.
--
-- One tenant-scoped table: org_id + RLS. Like ai_rate_limits it references only
-- organizations, so the org_id FK + RLS are the full isolation story. RLS is
-- hand-added at the end (invisible to Prisma's schema diff, exactly like
-- 20260703213500_tenant_rls and 20260710000000_slice_ai_rate_limit).

-- CreateTable
CREATE TABLE "proactive_scan_caches" (
    "org_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "pairings" JSONB NOT NULL DEFAULT '[]',
    "meeting_intelligence_active" BOOLEAN NOT NULL DEFAULT false,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "proactive_scan_caches_pkey" PRIMARY KEY ("org_id", "scope")
);

-- AddForeignKey
ALTER TABLE "proactive_scan_caches" ADD CONSTRAINT "proactive_scan_caches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "proactive_scan_caches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proactive_scan_caches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proactive_scan_caches"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
