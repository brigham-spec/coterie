-- Merge "Professional Team" (project_team_members) into the "Participants" roster
-- (project_links). project_links gains a surrogate id PK (so a company may hold
-- multiple roles), a nullable company_id (off-network manual entries), a plain
-- nullable contact_id FK (the primary contact, same-org enforced in the action),
-- and free-text name/org/email fallbacks. Existing team members are copied in,
-- resolving their fragile email match to a real contact FK once, then the old
-- table is dropped. project_links already has RLS + app_user grants (existing
-- table); ALTERing columns needs no new policy or grant.

-- 1. New columns on project_links.
ALTER TABLE "project_links" ADD COLUMN "id" UUID;
ALTER TABLE "project_links" ADD COLUMN "contact_id" UUID;
ALTER TABLE "project_links" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "project_links" ADD COLUMN "org" TEXT NOT NULL DEFAULT '';
ALTER TABLE "project_links" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

-- Backfill id for existing rows (Prisma generates uuid() client-side, so the
-- column carries no DB default — matching every other table's id).
UPDATE "project_links" SET "id" = gen_random_uuid();
ALTER TABLE "project_links" ALTER COLUMN "id" SET NOT NULL;

-- 2. Swap the primary key: drop the composite (project_id, company_id), add the
-- surrogate id (a company can now appear more than once, in different roles).
ALTER TABLE "project_links" DROP CONSTRAINT "project_links_pkey";
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_pkey" PRIMARY KEY ("id");

-- 3. company_id is now optional (null = off-network row). The existing composite
-- FK (company_id, org_id) -> companies stays; MATCH SIMPLE skips it when null.
ALTER TABLE "project_links" ALTER COLUMN "company_id" DROP NOT NULL;

-- 4. Primary-contact FK (plain, SetNull — a composite SetNull would fight org_id's
-- NOT NULL; same-org is enforced in the action inside withOrg) + new indexes.
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "project_links_project_id_idx" ON "project_links"("project_id");
CREATE INDEX "project_links_contact_id_idx" ON "project_links"("contact_id");

-- 5. Copy every professional-team member into the participant roster, resolving
-- its email to a real contact in the same org (LATERAL LIMIT 1 so a duplicate
-- email never fans out into duplicate participants). Runs as the DB owner during
-- migrate, so the cross-org read/write is not blocked by RLS.
INSERT INTO "project_links" ("id", "org_id", "project_id", "company_id", "contact_id", "role", "name", "org", "email", "created_at", "updated_at")
SELECT gen_random_uuid(), tm."org_id", tm."project_id", tm."company_id", c."id", tm."role", tm."name", tm."org", tm."email", tm."created_at", tm."updated_at"
FROM "project_team_members" tm
LEFT JOIN LATERAL (
  SELECT ct."id"
  FROM "contacts" ct
  WHERE ct."org_id" = tm."org_id"
    AND tm."email" <> ''
    AND lower(ct."email") = lower(tm."email")
  LIMIT 1
) c ON true;

-- 6. Retire the merged table.
DROP TABLE "project_team_members";
