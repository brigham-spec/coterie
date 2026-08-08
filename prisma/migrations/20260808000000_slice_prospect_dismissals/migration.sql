-- Prospect-finder dismissals (slice 11.6, Finder 16 — the prototype's persistent
-- "Dismiss" with a reason taxonomy). External discovery surfaces NEW organisations
-- that have no CRM row yet, so — unlike intro_dismissals — a dismissal references
-- nothing but a name. We store the normalized org name (target_key) plus a reason;
-- the finder merges these keys into excludeOrgs so parseProspectTargets drops the
-- dismissed org on the next scan.
--
-- One tenant-scoped table: org_id + RLS. No company/contact FK — these rows are
-- pre-CRM and reference nothing but a name (same shape as unmatched_attendees).
-- RLS is hand-added at the end (invisible to Prisma's schema diff, exactly like
-- 20260703213500_tenant_rls and the later slices).

-- CreateTable
CREATE TABLE "prospect_dismissals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "target_key" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'not_relevant',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prospect_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_dismissals_org_id_target_key_key" ON "prospect_dismissals"("org_id", "target_key");

-- CreateIndex
CREATE INDEX "prospect_dismissals_org_id_idx" ON "prospect_dismissals"("org_id");

-- AddForeignKey
ALTER TABLE "prospect_dismissals" ADD CONSTRAINT "prospect_dismissals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "prospect_dismissals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prospect_dismissals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prospect_dismissals"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
