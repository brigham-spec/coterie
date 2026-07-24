-- S7 · Profile field parity. Five additive, nullable/defaulted profile fields;
-- companies/contacts already carry tenant_isolation RLS (no policy change).
--   companies.likelihood            prospect likelihood 1–5 (pips + prospects filter)
--   companies.tier_locked           pin the tier manually vs. auto-assign from value
--   companies.referred_by_id        in-network referrer (self-FK)
--   companies.referred_by_external  external referrer name (not in the network)
--   companies.consulting            consulting / IDA engagement note (list badge)
--   contacts.additional_emails      extra emails beyond the primary (Fireflies match)

ALTER TABLE "companies"
  ADD COLUMN "likelihood" SMALLINT,
  ADD COLUMN "tier_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "referred_by_id" UUID,
  ADD COLUMN "referred_by_external" TEXT,
  ADD COLUMN "consulting" TEXT;

-- Likelihood is a 1–5 ranking; keep the domain honest at the DB, matching the
-- app-layer validation.
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_likelihood_range"
  CHECK ("likelihood" IS NULL OR ("likelihood" BETWEEN 1 AND 5));

ALTER TABLE "contacts"
  ADD COLUMN "additional_emails" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "companies_org_id_referred_by_id_idx" ON "companies"("org_id", "referred_by_id");

-- Self-referential referral: plain FK (SetNull). The referrer is first-class and
-- outlives being referenced; a composite (id, org_id) SetNull would fight org_id's
-- NOT NULL (same reasoning as introductions.event_id / project_id), so the app
-- layer re-checks the referrer is in-org inside withOrg.
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_referred_by_id_fkey"
  FOREIGN KEY ("referred_by_id") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
