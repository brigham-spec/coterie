-- Per-company Value Delivered ledger (slice P4). Records concrete wins the
-- network delivered to a member — an introduction that bore fruit, a grant, a
-- service — with the outcome and derived dollar value. Powers the profile's
-- Value Delivered card (per-member drill-down of value created).
--
-- One tenant-scoped table: org_id + RLS. company_id uses a COMPOSITE FK
-- (company_id, org_id) -> companies(id, org_id) so the recipient can never be a
-- company in another org (same guard as membership_proposals). introduction_id
-- is a plain nullable FK (introductions has no composite (id, org_id) target),
-- SetNull on the intro's delete — app-layer re-checked inside withOrg on write.
-- RLS is hand-added at the end (invisible to Prisma's schema diff, exactly like
-- 20260703213500_tenant_rls and the later slices).

-- CreateTable
CREATE TABLE "value_delivered" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "introduction_id" UUID,
    "amount" DECIMAL(14,2),
    "summary" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "occurred_at" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "value_delivered_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "value_delivered_org_id_idx" ON "value_delivered"("org_id");

-- CreateIndex
CREATE INDEX "value_delivered_company_id_idx" ON "value_delivered"("company_id");

-- CreateIndex
CREATE INDEX "value_delivered_org_id_occurred_at_idx" ON "value_delivered"("org_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "value_delivered" ADD CONSTRAINT "value_delivered_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_delivered" ADD CONSTRAINT "value_delivered_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_delivered" ADD CONSTRAINT "value_delivered_introduction_id_fkey" FOREIGN KEY ("introduction_id") REFERENCES "introductions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "value_delivered" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_delivered" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "value_delivered"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
