-- New Connections Detected — durable triage queue (unmatched_attendees) for
-- Fireflies attendees that matched no contact (the prototype's UNMATCHED_KEY).
--
-- One tenant-scoped table: org_id + RLS. Unlike intro_dismissals it needs NO
-- composite-FK guard — the rows are pre-CRM and reference no company/contact, so
-- the org_id FK + RLS are the full isolation story. RLS is hand-added at the end
-- (invisible to Prisma's schema diff, exactly like 20260703213500_tenant_rls and
-- 20260707000000_slice_11_4c_intro_dismissals).

-- CreateTable
CREATE TABLE "unmatched_attendees" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "inferred_name" TEXT,
    "inferred_org" TEXT,
    "meeting_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "last_meeting_title" TEXT,
    "dismissed_at" TIMESTAMPTZ(6),
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "unmatched_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unmatched_attendees_org_id_idx" ON "unmatched_attendees"("org_id");

-- CreateIndex
CREATE INDEX "unmatched_attendees_org_id_domain_idx" ON "unmatched_attendees"("org_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "unmatched_attendees_org_id_email_key" ON "unmatched_attendees"("org_id", "email");

-- AddForeignKey
ALTER TABLE "unmatched_attendees" ADD CONSTRAINT "unmatched_attendees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "unmatched_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "unmatched_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "unmatched_attendees"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
