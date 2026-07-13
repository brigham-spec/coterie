-- Additional Companies & Affiliations (slice P5). A member often wears more than
-- one hat — a separate business line or capacity, each with its own offer/need
-- profile — so the network can see and match on every hat. A lightweight flat
-- sub-record of the owning company (mirrors the prototype's inline editor), not a
-- company row itself.
--
-- One tenant-scoped table: org_id + RLS. company_id uses a COMPOSITE FK
-- (company_id, org_id) -> companies(id, org_id) so an affiliation can only hang
-- off a member in the same org (same guard as value_delivered / membership_
-- proposals). RLS is hand-added at the end (invisible to Prisma's schema diff,
-- exactly like the earlier slices).

-- CreateTable
CREATE TABLE "affiliations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "can_offer" TEXT NOT NULL DEFAULT '',
    "looking_for" TEXT NOT NULL DEFAULT '',
    "counties" TEXT NOT NULL DEFAULT '',
    "deal_size" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliations_org_id_idx" ON "affiliations"("org_id");

-- CreateIndex
CREATE INDEX "affiliations_company_id_idx" ON "affiliations"("company_id");

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "affiliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "affiliations"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
