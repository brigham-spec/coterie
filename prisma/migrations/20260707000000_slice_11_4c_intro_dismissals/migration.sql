-- Slice 11.4c — durable introduction-dismissal ledger (intro_dismissals).
--
-- One new tenant-scoped table so the intro engine can persist "don't suggest this
-- pairing again" decisions (the prototype's DISMISSED_KEY). It gets the FULL
-- tenant treatment (CLAUDE.md cardinal rule #1): org_id + composite-FK cross-org
-- guards on both company references (declared in schema, generated below) + RLS
-- ENABLE/FORCE + the tenant_isolation policy (hand-added at the end — RLS is
-- invisible to Prisma's schema diff, exactly like migrations 20260703213500 and
-- 20260706000000).

-- CreateTable
CREATE TABLE "intro_dismissals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "focus_company_id" UUID NOT NULL,
    "candidate_company_id" UUID NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'not_relevant',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intro_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intro_dismissals_org_id_idx" ON "intro_dismissals"("org_id");

-- CreateIndex
CREATE INDEX "intro_dismissals_org_id_focus_company_id_idx" ON "intro_dismissals"("org_id", "focus_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "intro_dismissals_org_id_focus_company_id_candidate_company__key" ON "intro_dismissals"("org_id", "focus_company_id", "candidate_company_id");

-- AddForeignKey
ALTER TABLE "intro_dismissals" ADD CONSTRAINT "intro_dismissals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_dismissals" ADD CONSTRAINT "intro_dismissals_focus_company_id_org_id_fkey" FOREIGN KEY ("focus_company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_dismissals" ADD CONSTRAINT "intro_dismissals_candidate_company_id_org_id_fkey" FOREIGN KEY ("candidate_company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see the item-3
-- migration 20260703213500_tenant_rls for the rationale). ENABLE + FORCE (the app
-- connects as table owner, who bypasses ordinary RLS) + a tenant_isolation policy
-- keyed to the tx-local GUC app.org_id. NULLIF(...,'') makes an unset GUC fail
-- closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "intro_dismissals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intro_dismissals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intro_dismissals"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
