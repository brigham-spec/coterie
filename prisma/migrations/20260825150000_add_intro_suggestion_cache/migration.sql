-- Per-company intro-suggestion cache — snapshot of the last AI intro scan for a
-- company profile (written by suggestIntros). Lets the profile's "Suggested
-- introductions" card hydrate instantly from cache on revisit and only re-fire the
-- expensive AI scan on demand. Keyed by (org_id, focus_company_id) — one cached scan
-- per focus company. suggestions is the IntroSuggestion[] payload stored verbatim as
-- JSON and re-filtered against intro_dismissals on read.
--
-- One tenant-scoped table: org_id + RLS. focus_company_id uses a COMPOSITE FK
-- (focus_company_id, org_id) -> companies(id, org_id) so a cache row can only hang off
-- a company in the same org, and cascades away when that company is deleted. RLS is
-- hand-added at the end (invisible to Prisma's schema diff, exactly like
-- 20260703213500_tenant_rls and 20260727000000_slice_proactive_scan_cache).

-- CreateTable
CREATE TABLE "intro_suggestion_caches" (
    "org_id" UUID NOT NULL,
    "focus_company_id" UUID NOT NULL,
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "meeting_intelligence_active" BOOLEAN NOT NULL DEFAULT false,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intro_suggestion_caches_pkey" PRIMARY KEY ("org_id", "focus_company_id")
);

-- CreateIndex
CREATE INDEX "intro_suggestion_caches_org_id_idx" ON "intro_suggestion_caches"("org_id");

-- AddForeignKey
ALTER TABLE "intro_suggestion_caches" ADD CONSTRAINT "intro_suggestion_caches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_suggestion_caches" ADD CONSTRAINT "intro_suggestion_caches_focus_company_id_org_id_fkey" FOREIGN KEY ("focus_company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "intro_suggestion_caches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intro_suggestion_caches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intro_suggestion_caches"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
