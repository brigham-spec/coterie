-- Their Network — key relationships (slice P6b). A strategic partner's value is
-- often the doors they can open: key external contacts they can connect the
-- network with. Each is a flat sub-record of the owning partner company, with an
-- optional link to a CRM company once that contact's org enters this tenant as a
-- member/prospect. Emails feed meeting matching.
--
-- One tenant-scoped table: org_id + RLS. company_id uses a COMPOSITE FK
-- (company_id, org_id) -> companies(id, org_id) so a relationship can only hang
-- off a partner in the same org. linked_company_id is a PLAIN nullable FK to
-- companies(id) with ON DELETE SET NULL (a composite SET NULL would fight the
-- NOT NULL org_id); same-org linking is enforced in the action inside withOrg
-- (RLS), mirroring companies.owner_user_id. RLS is hand-added at the end.

-- CreateTable
CREATE TABLE "key_relationships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "org" TEXT NOT NULL DEFAULT '',
    "relevance" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "linked_company_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "key_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "key_relationships_org_id_idx" ON "key_relationships"("org_id");

-- CreateIndex
CREATE INDEX "key_relationships_company_id_idx" ON "key_relationships"("company_id");

-- AddForeignKey
ALTER TABLE "key_relationships" ADD CONSTRAINT "key_relationships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_relationships" ADD CONSTRAINT "key_relationships_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_relationships" ADD CONSTRAINT "key_relationships_linked_company_id_fkey" FOREIGN KEY ("linked_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "key_relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "key_relationships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "key_relationships"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
