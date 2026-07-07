-- Slice 11.0 — data-model expansion (purely additive).
--
-- Adds the rich fields the prototype-parity features need: new nullable/defaulted
-- columns on companies/contacts/projects, and three new tenant-scoped tables
-- (events, event_invitees, membership_proposals). Nothing is dropped or renamed.
--
-- The three new tables get the FULL tenant treatment (CLAUDE.md cardinal rule #1):
-- org_id + composite-FK cross-org guards (declared in schema, generated below) +
-- RLS ENABLE/FORCE + the tenant_isolation policy (hand-added at the end — RLS is
-- invisible to Prisma's schema diff, exactly like migration 20260703213500).
--
-- Backfill of existing HVEDC data is a SEPARATE, idempotent data script
-- (scripts/backfill-slice-11-0.mjs) run after this migration, not here — it
-- re-reads the source JSON and must be re-runnable independently.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "agency_contacts" TEXT,
ADD COLUMN     "can_offer" TEXT,
ADD COLUMN     "counties" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deal_size" TEXT,
ADD COLUMN     "last_contact_at" TIMESTAMPTZ(6),
ADD COLUMN     "looking_for" TEXT,
ADD COLUMN     "member_since" INTEGER,
ADD COLUMN     "network_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "owner_user_id" UUID,
ADD COLUMN     "services" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "county" TEXT,
ADD COLUMN     "economic_impact" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "funding_sources" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "hv_services" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "prospect_lead" TEXT,
ADD COLUMN     "realized_value" DECIMAL(14,2),
ADD COLUMN     "stage_history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "type" TEXT,
ADD COLUMN     "units" INTEGER;

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'planning',
    "date" TIMESTAMPTZ(6),
    "venue" TEXT,
    "capacity" INTEGER,
    "theme" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "cost" DECIMAL(14,2),
    "project_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_invitees" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "contact_id" UUID,
    "external_name" TEXT,
    "external_org" TEXT,
    "rsvp" TEXT NOT NULL DEFAULT 'invited',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_invitees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_proposals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sent_on" DATE,
    "last_follow_up_at" TIMESTAMPTZ(6),
    "drive_url" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_org_id_idx" ON "events"("org_id");

-- CreateIndex
CREATE INDEX "events_org_id_date_idx" ON "events"("org_id", "date" DESC);

-- CreateIndex
CREATE INDEX "events_project_id_idx" ON "events"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_id_org_id_key" ON "events"("id", "org_id");

-- CreateIndex
CREATE INDEX "event_invitees_org_id_idx" ON "event_invitees"("org_id");

-- CreateIndex
CREATE INDEX "event_invitees_event_id_idx" ON "event_invitees"("event_id");

-- CreateIndex
CREATE INDEX "event_invitees_contact_id_idx" ON "event_invitees"("contact_id");

-- CreateIndex
CREATE INDEX "membership_proposals_org_id_idx" ON "membership_proposals"("org_id");

-- CreateIndex
CREATE INDEX "membership_proposals_company_id_idx" ON "membership_proposals"("company_id");

-- CreateIndex
CREATE INDEX "membership_proposals_org_id_status_idx" ON "membership_proposals"("org_id", "status");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_event_id_org_id_fkey" FOREIGN KEY ("event_id", "org_id") REFERENCES "events"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_proposals" ADD CONSTRAINT "membership_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_proposals" ADD CONSTRAINT "membership_proposals_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the three new tenant tables (hand-added; see the
-- item-3 migration 20260703213500_tenant_rls for the rationale). ENABLE + FORCE
-- (the app connects as table owner, who bypasses ordinary RLS) + a
-- tenant_isolation policy keyed to the tx-local GUC app.org_id. NULLIF(...,'')
-- makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events', 'event_invitees', 'membership_proposals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid) '
      'WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
