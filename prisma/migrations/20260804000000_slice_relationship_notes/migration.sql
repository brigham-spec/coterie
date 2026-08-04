-- Manual relationship notes (slice S8c, Members audit item 24 — the prototype's
-- timelineNotes[] on the member modal, Coterie.html:6217). A free-text touchpoint
-- a user records against a company, merged into the relationship timeline next to
-- the derived facts (meetings, intros, commitments). Unlike those, a note is
-- directly authored, so it's the one timeline source the profile can add/edit/delete.
--
-- One tenant-scoped table: org_id + RLS. company_id uses a COMPOSITE FK
-- (company_id, org_id) -> companies(id, org_id) so a note can never hang off a
-- company in another org (same guard as value_delivered / membership_proposals).
-- actor_user_id is a plain nullable FK to users(id), SetNull on the author's delete
-- so the note survives. RLS is hand-added at the end (invisible to Prisma's schema
-- diff, exactly like 20260703213500_tenant_rls and the later slices).

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "body" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_org_id_idx" ON "notes"("org_id");

-- CreateIndex
CREATE INDEX "notes_company_id_idx" ON "notes"("company_id");

-- CreateIndex
CREATE INDEX "notes_org_id_occurred_at_idx" ON "notes"("org_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_org_id_fkey" FOREIGN KEY ("company_id", "org_id") REFERENCES "companies"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notes"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
