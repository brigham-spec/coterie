-- Projects-module parity (audit Projects #3, #4). Two additive columns on the
-- existing `projects` table:
--   industry            — sector, distinct from the phase `type` (demo `industry`);
--                         feeds funding-source suggestions and the profile facts.
--   developer_member_id — the developer/lead as a CRM company when one exists
--                         (demo `developerMemberId`). PLAIN nullable FK to
--                         companies(id) ON DELETE SET NULL (a composite SET NULL
--                         would fight the NOT NULL org_id); same-org linking is
--                         enforced in the action inside withOrg (RLS), mirroring
--                         project_team_members.company_id.
--
-- No new RLS policy — `projects` already ENABLE/FORCE row-level security.

-- AlterTable
ALTER TABLE "projects"
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "developer_member_id" UUID;

-- CreateIndex
CREATE INDEX "projects_developer_member_id_idx" ON "projects"("developer_member_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_developer_member_id_fkey" FOREIGN KEY ("developer_member_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
