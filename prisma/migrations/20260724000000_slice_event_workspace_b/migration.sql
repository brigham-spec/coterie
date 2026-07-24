-- S2 · Events workspace part B: link follow-up commitments and introductions to
-- the event they came out of (post-event debrief). Both columns are additive and
-- nullable; the existing tenant_isolation RLS on action_items/introductions
-- already covers them (no policy change).

ALTER TABLE "action_items" ADD COLUMN "event_id" UUID;
ALTER TABLE "introductions" ADD COLUMN "event_id" UUID;

CREATE INDEX "action_items_org_id_event_id_idx" ON "action_items"("org_id", "event_id");
CREATE INDEX "introductions_event_id_idx" ON "introductions"("event_id");

-- Composite FK (event_id, org_id) -> events(id, org_id): a follow-up item can
-- never straddle orgs (mirrors project_id/company_id). Cascade with the event.
ALTER TABLE "action_items"
  ADD CONSTRAINT "action_items_event_id_org_id_fkey"
  FOREIGN KEY ("event_id", "org_id") REFERENCES "events"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Plain FK (SetNull) — an introduction is first-class and outlives the event;
-- a composite SetNull would fight org_id's NOT NULL, so keep the app-layer
-- withOrg re-check (same pattern as introductions.project_id / events.project_id).
ALTER TABLE "introductions"
  ADD CONSTRAINT "introductions_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
