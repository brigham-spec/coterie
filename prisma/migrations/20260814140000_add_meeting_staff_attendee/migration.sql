-- Tier-3 personalization: which of the tenant's own staff attended a meeting.
-- Fireflies carries attendee emails but no host/organizer, and the credential is
-- org-wide, so reconcile identifies a staffer by matching the attendee email
-- against the org's users. One tenant-scoped table: org_id + RLS. meeting_id uses
-- a COMPOSITE FK (meeting_id, org_id) -> meetings(id, org_id) so a link can only
-- hang off a meeting in the same org; user_id is a PLAIN FK to users(id) (users
-- are platform-level, no org_id). RLS is hand-added at the end.

-- CreateTable
CREATE TABLE "meeting_staff_attendees" (
    "org_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_staff_attendees_pkey" PRIMARY KEY ("meeting_id", "user_id")
);

-- CreateIndex
CREATE INDEX "meeting_staff_attendees_org_id_idx" ON "meeting_staff_attendees"("org_id");

-- CreateIndex
CREATE INDEX "meeting_staff_attendees_user_id_idx" ON "meeting_staff_attendees"("user_id");

-- AddForeignKey
ALTER TABLE "meeting_staff_attendees" ADD CONSTRAINT "meeting_staff_attendees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_staff_attendees" ADD CONSTRAINT "meeting_staff_attendees_meeting_id_org_id_fkey" FOREIGN KEY ("meeting_id", "org_id") REFERENCES "meetings"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_staff_attendees" ADD CONSTRAINT "meeting_staff_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "meeting_staff_attendees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_staff_attendees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "meeting_staff_attendees"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
