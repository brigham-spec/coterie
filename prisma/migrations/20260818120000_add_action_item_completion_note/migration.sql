-- A reviewable note captured when an action item is marked done (how the
-- follow-up was resolved). Additive nullable column inherits the action_items
-- table's existing RLS.
ALTER TABLE "action_items" ADD COLUMN "completion_note" TEXT;
