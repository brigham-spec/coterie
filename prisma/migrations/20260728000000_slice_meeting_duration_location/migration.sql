-- Meeting duration + location (S5a, Meetings audit item 11 — the prototype's
-- manual "Log Meeting" modal captures Duration (minutes) + Location, Coterie.html
-- :1918-1924). Two optional scalars on the existing meetings table; only the
-- manual log writes them (Fireflies sync leaves them null). No RLS change — the
-- meetings table already enforces tenant isolation (org_id + policy).
ALTER TABLE "meetings" ADD COLUMN "duration_minutes" SMALLINT;
ALTER TABLE "meetings" ADD COLUMN "location" TEXT;
