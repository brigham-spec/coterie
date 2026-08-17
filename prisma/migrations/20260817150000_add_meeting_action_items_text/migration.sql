-- Fireflies delivers a structured `action_items` text alongside the narrative
-- overview; store it separately so extraction reads real commitments (with
-- owners) instead of the thematic summary. Additive nullable column inherits
-- the meetings table's existing RLS.
ALTER TABLE "meetings" ADD COLUMN "action_items_text" TEXT;
