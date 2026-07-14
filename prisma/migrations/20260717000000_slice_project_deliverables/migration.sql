-- Project deliverables (projects-module parity). A deliverable is an action_item
-- attached to a project — a follow-up the org owes the project ("we owe", a staff
-- owner) or the network owes back ("they owe", a contact owner). Reuses the
-- existing action_items table + owner-XOR CHECK rather than a new table; this
-- slice only adds the optional project link.
--
-- project_id uses a COMPOSITE FK (project_id, org_id) -> projects(id, org_id) so a
-- deliverable can never straddle orgs (same guard as project_links). ON DELETE
-- CASCADE (not SET NULL): a composite SET NULL would try to null org_id too, which
-- is NOT NULL — so a project's deliverables die with the project. action_items
-- already has RLS (20260703213500_tenant_rls), so no new policy is needed.

-- AlterTable
ALTER TABLE "action_items" ADD COLUMN "project_id" UUID;

-- CreateIndex
CREATE INDEX "action_items_org_id_project_id_idx" ON "action_items"("org_id", "project_id");

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;
