-- Collateral knowledge store: one tenant-scoped table holding a piece of an org's
-- own material (pitch deck, value-prop one-pager, SOP) as EXTRACTED TEXT, never a
-- binary. Grounds the proposal + prospect value-prop generators in each org's real
-- collateral, per-tenant. RLS is hand-added at the end.

-- CreateTable
CREATE TABLE "knowledge_docs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_name" TEXT,
    "char_count" INTEGER NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_docs_org_id_idx" ON "knowledge_docs"("org_id");

-- CreateIndex
CREATE INDEX "knowledge_docs_org_id_kind_idx" ON "knowledge_docs"("org_id", "kind");

-- AddForeignKey
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "knowledge_docs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_docs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "knowledge_docs"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
