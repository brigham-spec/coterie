-- Email Intelligence (slice 11.12) — synced client correspondence. A Zapier zap
-- has Claude analyse each inbound email and append a row to a published Google
-- Sheet; a sync pulls that CSV, matches each row to a company, and lands it here.
--
-- One tenant-scoped table: org_id + RLS. company_id is a plain nullable FK
-- (SetNull on company delete) — matching runs inside withOrg so the assigned
-- company is always same-tenant, and unmatched mail is stored with NULL so it can
-- surface in a triage bucket. RLS is hand-added at the end (invisible to Prisma's
-- schema diff, exactly like 20260703213500_tenant_rls and the later slices).

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID,
    "external_key" TEXT NOT NULL,
    "from_name" TEXT NOT NULL DEFAULT '',
    "from_email" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "projects" TEXT NOT NULL DEFAULT '',
    "action_items" TEXT NOT NULL DEFAULT '',
    "sentiment" TEXT NOT NULL DEFAULT '',
    "email_date" TEXT NOT NULL DEFAULT '',
    "synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_messages_org_id_idx" ON "email_messages"("org_id");

-- CreateIndex
CREATE INDEX "email_messages_company_id_idx" ON "email_messages"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_org_id_external_key_key" ON "email_messages"("org_id", "external_key");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_messages"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
