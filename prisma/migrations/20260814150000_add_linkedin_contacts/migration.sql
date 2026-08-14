-- LinkedIn contact layer: a separate storage tier for a tenant's exported LinkedIn
-- connections (a "recall prosthetic"), kept apart from members/contacts so it never
-- clutters the main lists. Two tenant-scoped tables (org_id + RLS):
--   linkedin_imports  — one row per CSV upload (snapshot-of-record + export date).
--   linkedin_contacts — one row per person (deduped across imports), with STATED
--     fields verbatim from the CSV and INFERRED dimensions left null until the
--     enrichment pass fills them (enriched_at null = invisible to recall search).
-- promoted_contact_id uses a COMPOSITE FK (promoted_contact_id, org_id) ->
-- contacts(id, org_id) so a promotion target can only be a contact in the same org.
-- RLS is hand-added at the end.

-- CreateTable
CREATE TABLE "linkedin_imports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "exported_on" TIMESTAMPTZ(6),
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linkedin_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_contacts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "profile_url" TEXT,
    "email" TEXT,
    "connected_on" TIMESTAMPTZ(6),
    "industry" TEXT,
    "industry_source" TEXT,
    "industry_confidence" TEXT,
    "geography" TEXT,
    "geography_source" TEXT,
    "geography_confidence" TEXT,
    "seniority" TEXT,
    "seniority_source" TEXT,
    "seniority_confidence" TEXT,
    "job_function" TEXT,
    "job_function_source" TEXT,
    "job_function_confidence" TEXT,
    "enriched_at" TIMESTAMPTZ(6),
    "promoted_contact_id" UUID,
    "promoted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "linkedin_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "linkedin_imports_org_id_idx" ON "linkedin_imports"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_contacts_org_id_dedupe_key_key" ON "linkedin_contacts"("org_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_contacts_promoted_contact_id_org_id_key" ON "linkedin_contacts"("promoted_contact_id", "org_id");

-- CreateIndex
CREATE INDEX "linkedin_contacts_org_id_idx" ON "linkedin_contacts"("org_id");

-- CreateIndex
CREATE INDEX "linkedin_contacts_org_id_import_id_idx" ON "linkedin_contacts"("org_id", "import_id");

-- CreateIndex
CREATE INDEX "linkedin_contacts_org_id_enriched_at_idx" ON "linkedin_contacts"("org_id", "enriched_at");

-- AddForeignKey
ALTER TABLE "linkedin_imports" ADD CONSTRAINT "linkedin_imports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_contacts" ADD CONSTRAINT "linkedin_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_contacts" ADD CONSTRAINT "linkedin_contacts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "linkedin_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_contacts" ADD CONSTRAINT "linkedin_contacts_promoted_contact_id_org_id_fkey" FOREIGN KEY ("promoted_contact_id", "org_id") REFERENCES "contacts"("id", "org_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the two new tenant tables (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "linkedin_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "linkedin_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "linkedin_imports"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE "linkedin_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "linkedin_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "linkedin_contacts"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
