-- CreateTable
CREATE TABLE "deleted_records" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deleted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deleted_records_org_id_idx" ON "deleted_records"("org_id");

-- CreateIndex
CREATE INDEX "deleted_records_org_id_created_at_idx" ON "deleted_records"("org_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "deleted_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deleted_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deleted_records"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
