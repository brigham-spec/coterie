-- Partnership section (slice P6a). Strategic-partner companies (a government
-- agency, economic-dev office, financial institution, etc.) carry a small block
-- of partnership-specific context the prototype's member modal edits in place:
-- what kind of partner they are, how HVEDC relates to them, a who-they-are/why-
-- strategic summary (AI-fillable), and what we're actively collaborating on.
--
-- These are plain scalar columns on the existing companies table — no new table,
-- so companies' existing RLS already scopes them. All four default to '' and are
-- backfilled on every existing row.
ALTER TABLE "companies" ADD COLUMN "partner_category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "partner_relationship" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "partner_summary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "collaboration_notes" TEXT NOT NULL DEFAULT '';
