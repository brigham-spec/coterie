-- Company-profile enrichment slice:
--  (1) companies gains a secondary profile triplet (additional business lines /
--      capabilities synthesized from affiliations + documents) — supporting signal
--      for the intro engine, weighted below the primary looking_for/can_offer.
--  (2) affiliations gains an optional contact_id (composite FK to contacts(id,
--      org_id), SetNull) so an affiliation can name a real in-org person.
--  (3) a new company_documents table persists the AI summary + file name of an
--      analyzed document so it stays visible after a refresh (raw file bytes are a
--      later Vercel-Blob follow-up).
-- Additive columns on existing RLS tables inherit grants. The NEW table gets RLS
-- hand-added below (ENABLE + FORCE + tenant_isolation) and needs app_user grants on
-- prod via scripts/bootstrap-app-role.mjs.

-- AlterTable
ALTER TABLE "affiliations" ADD COLUMN     "contact_id" UUID;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "secondary_can_offer" TEXT,
ADD COLUMN     "secondary_industry" TEXT,
ADD COLUMN     "secondary_looking_for" TEXT;

-- CreateTable
CREATE TABLE "company_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_documents_org_id_idx" ON "company_documents"("org_id");

-- CreateIndex
CREATE INDEX "company_documents_company_id_idx" ON "company_documents"("company_id");

-- CreateIndex
CREATE INDEX "affiliations_contact_id_idx" ON "affiliations"("contact_id");

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_contact_id_org_id_fkey" FOREIGN KEY ("contact_id", "org_id") REFERENCES "contacts"("id", "org_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "company_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_documents"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
