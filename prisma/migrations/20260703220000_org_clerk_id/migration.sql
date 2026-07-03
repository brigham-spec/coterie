-- Identity bridge: map a Clerk organization (org_…) to our tenant uuid.
-- Mirrors users.clerk_id. Nullable so seeded test tenants and the HVEDC data
-- migration need no Clerk org; unique index permits multiple NULLs in Postgres.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "clerk_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_clerk_id_key" ON "organizations"("clerk_id");
