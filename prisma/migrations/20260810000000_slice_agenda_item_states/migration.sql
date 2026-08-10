-- Daily Focus agenda-item triage overlay (slice 11.z12, Dashboard 8 — the
-- prototype's per-item done/snooze/waiting on the Daily Focus card). Focus items
-- are regenerated on demand, but each maps to a durable actionItem or event row,
-- so a lightweight overlay keyed by (kind, ref_id) carries the triage across
-- regenerations. No FK on ref_id — it points at one of two tables (commitments vs
-- events) — so a deleted source row leaves a harmless orphan that never matches a
-- live item. Org-scoped (shared across the org's staff, like the focus itself).
--
-- One tenant-scoped table: org_id + RLS. RLS is hand-added at the end (invisible
-- to Prisma's schema diff, exactly like 20260703213500_tenant_rls and later slices).

-- CreateTable
CREATE TABLE "agenda_item_states" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "snoozed_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agenda_item_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agenda_item_states_org_id_kind_ref_id_key" ON "agenda_item_states"("org_id", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "agenda_item_states_org_id_idx" ON "agenda_item_states"("org_id");

-- AddForeignKey
ALTER TABLE "agenda_item_states" ADD CONSTRAINT "agenda_item_states_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "agenda_item_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenda_item_states" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agenda_item_states"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
