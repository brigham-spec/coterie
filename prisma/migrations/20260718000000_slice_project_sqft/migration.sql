-- Project field parity (projects-module gap). Adds gross square footage — a
-- pipeline metric the prototype tracks on every project alongside units/keys
-- (demo `sqft`). Nullable, no backfill needed. Developer/Lead already exists as
-- projects.prospect_lead; this slice only wires it into the create form.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "sqft" INTEGER;
