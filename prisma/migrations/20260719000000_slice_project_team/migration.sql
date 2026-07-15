-- Professional Team on a project (projects-module parity; ported from the
-- prototype's Professional Team section, Coterie.html:17662). Unlike project_links
-- (a CRM company in a pipeline role), a team member is an INDIVIDUAL professional
-- — architect, land-use attorney, lender, GC, etc. — captured as free text so
-- off-network professionals can be tracked, with an OPTIONAL link to a CRM company
-- when the firm already exists in the tenant.
--
-- One tenant-scoped table: org_id + RLS. project_id uses a COMPOSITE FK
-- (project_id, org_id) -> projects(id, org_id) so a member can never straddle
-- orgs (Cascade — members die with the project). company_id is a PLAIN nullable
-- FK to companies(id) with ON DELETE SET NULL (a composite SET NULL would fight
-- the NOT NULL org_id); same-org linking is enforced in the action inside withOrg
-- (RLS), mirroring key_relationships.linked_company_id. RLS is hand-added at the end.

-- CreateTable
CREATE TABLE "project_team_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "org" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "company_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_team_members_org_id_idx" ON "project_team_members"("org_id");

-- CreateIndex
CREATE INDEX "project_team_members_project_id_idx" ON "project_team_members"("project_id");

-- AddForeignKey
ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "project_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "project_team_members"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
