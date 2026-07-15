-- Attach manual commitments directly to a company (per-profile action items,
-- ported from the prototype's Action Items section on the member modal,
-- Coterie.html action-items block). A commitment logged on a company profile has
-- no meeting and no project, so without a company link a "we owe" item (owned by
-- staff) would attach to nothing. company_id is NULLABLE — meeting-derived items
-- and project deliverables carry none.
--
-- Composite FK (company_id, org_id) -> companies(id, org_id) so a commitment can
-- never straddle orgs (mirrors the existing project_id composite FK). Cascade: a
-- company's manual commitments die with it. A nullable component means the FK is
-- unchecked when company_id IS NULL (MATCH SIMPLE), so existing rows are fine.
-- action_items already carries RLS (see 20260703213500_tenant_rls), so no policy
-- change is needed — the new column is covered by the existing tenant_isolation.

-- AlterTable
ALTER TABLE "action_items" ADD COLUMN "company_id" UUID;

-- CreateIndex
CREATE INDEX "action_items_org_id_company_id_idx" ON "action_items"("org_id", "company_id");

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;
