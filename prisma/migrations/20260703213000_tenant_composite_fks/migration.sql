-- Tenant isolation, part 1: same-org structural constraints.
--
-- Composite unique keys (id, org_id) on the parent tables let the junction
-- tables reference (fk_id, org_id) so a link can NEVER straddle two orgs.
-- See CLAUDE.md cardinal rule #1 and prisma/schema.prisma junction comments.

-- DropForeignKey
ALTER TABLE "meeting_attendees" DROP CONSTRAINT "meeting_attendees_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "meeting_attendees" DROP CONSTRAINT "meeting_attendees_meeting_id_fkey";

-- DropForeignKey
ALTER TABLE "project_links" DROP CONSTRAINT "project_links_company_id_fkey";

-- DropForeignKey
ALTER TABLE "project_links" DROP CONSTRAINT "project_links_project_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_org_id_key" ON "companies"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_id_org_id_key" ON "contacts"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_id_org_id_key" ON "meetings"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_org_id_key" ON "projects"("id", "org_id");

-- AddForeignKey
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_org_id_fkey" FOREIGN KEY ("meeting_id", "org_id") REFERENCES "meetings"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_contact_id_org_id_fkey" FOREIGN KEY ("contact_id", "org_id") REFERENCES "contacts"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Action item owner is polymorphic: EXACTLY ONE of owner_user_id (staff, "we
-- owe") or owner_contact_id (network, "they owe"). Prisma cannot express CHECK
-- constraints, so it is added here and is not tracked as schema drift.
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_owner_xor"
  CHECK (("owner_user_id" IS NOT NULL) <> ("owner_contact_id" IS NOT NULL));
