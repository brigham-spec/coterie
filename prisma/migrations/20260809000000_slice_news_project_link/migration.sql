-- News audit item 5: cross-link a saved article to a project. Additive nullable
-- FK on news_items → projects. SetNull so deleting a project just unlinks its
-- articles (they stay attached to their company). news_items already carries
-- table-level tenant_isolation RLS, so no new policy is needed here.
ALTER TABLE "news_items" ADD COLUMN "project_id" UUID;
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "news_items_project_id_idx" ON "news_items"("project_id");
