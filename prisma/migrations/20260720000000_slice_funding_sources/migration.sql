-- Funding Sources & Grants on a project (projects-module parity; ported from the
-- prototype's Funding Sources & Grants section, Coterie.html:10228). Each row is a
-- state/federal/alternative capital program the project is pursuing — added
-- manually or promoted from an AI suggestion.
--
-- This replaces the DEAD `projects.funding_sources` JSON column (added in the
-- slice-11.0 additive expansion but never read/written by any action — only the
-- generated client referenced it) with a NORMALIZED tenant table. The JSON column
-- name collides with the new relation, so it is dropped first; the drop is safe
-- because no source code touched it.
--
-- One tenant-scoped table: org_id + RLS. project_id uses a COMPOSITE FK
-- (project_id, org_id) -> projects(id, org_id) so a source can never straddle
-- orgs (Cascade — sources die with the project). RLS is hand-added at the end.

-- DropColumn (dead JSON column; no data to preserve)
ALTER TABLE "projects" DROP COLUMN "funding_sources";

-- CreateTable
CREATE TABLE "funding_sources" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "agency" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'Grant',
    "estimated_benefit" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Identified',
    "rationale" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funding_sources_org_id_idx" ON "funding_sources"("org_id");

-- CreateIndex
CREATE INDEX "funding_sources_project_id_idx" ON "funding_sources"("project_id");

-- AddForeignKey
ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security for the new tenant table (hand-added; see 20260703213500_
-- tenant_rls for rationale). ENABLE + FORCE (the app connects as table owner, who
-- bypasses ordinary RLS) + a tenant_isolation policy keyed to the tx-local GUC
-- app.org_id. NULLIF(...,'') makes an unset GUC fail closed (no rows).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "funding_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "funding_sources"
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
