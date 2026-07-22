-- Event workspace, part A (prototype eventModal parity, Coterie.html:8195-8410).
-- Two additive changes, both backfill-safe:
--
--   1. event_invitees gains external_email / external_title so an external (non-CRM)
--      guest carries the same contact facts the prototype captured (extEmail/extTitle
--      at Coterie.html:8198). Nullable — existing external guests keep NULLs.
--
--   2. A new tenant table event_conversions: prospects/attendees who joined as paying
--      members as a direct result of an event (prototype draft.conversions,
--      Coterie.html:8361). Each row carries the joining member's ARR — the sole data
--      source for an event's Projected ROI and the network's New-members / Net-ROI
--      metrics. company_id is a plain FK (SetNull, app-layer re-checked inside withOrg
--      like event_invitees.contact_id) because a composite FK would force SetNull to
--      null the required org_id; name is snapshotted so a removed company still reads.

-- AlterTable
ALTER TABLE "event_invitees" ADD COLUMN "external_email" TEXT;
ALTER TABLE "event_invitees" ADD COLUMN "external_title" TEXT;

-- CreateTable
CREATE TABLE "event_conversions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "arr" DECIMAL(14,2),
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_conversions_org_id_idx" ON "event_conversions"("org_id");

-- CreateIndex
CREATE INDEX "event_conversions_event_id_idx" ON "event_conversions"("event_id");

-- CreateIndex
CREATE INDEX "event_conversions_company_id_idx" ON "event_conversions"("company_id");

-- AddForeignKey
ALTER TABLE "event_conversions" ADD CONSTRAINT "event_conversions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite → keeps a conversion in its event's org; dies with the event)
ALTER TABLE "event_conversions" ADD CONSTRAINT "event_conversions_event_id_org_id_fkey" FOREIGN KEY ("event_id", "org_id") REFERENCES "events"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (plain FK, SetNull — app-layer re-checked inside withOrg)
ALTER TABLE "event_conversions" ADD CONSTRAINT "event_conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "event_conversions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_conversions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "event_conversions"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
