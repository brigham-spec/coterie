-- What the project is asking the org to help with (@/lib/project-assistance
-- keys). Additive array column with an empty default, so existing rows backfill
-- cleanly; inherits the projects table's existing RLS.
ALTER TABLE "projects" ADD COLUMN "assistance_requested" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
