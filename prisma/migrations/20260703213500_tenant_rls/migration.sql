-- Tenant isolation, part 2: Postgres row-level security (RLS).
--
-- Every tenant-scoped table is default-deny and only exposes rows whose org_id
-- matches the transaction-local GUC `app.org_id`, which the application sets at
-- the start of each request/transaction (see src/lib/tenant.ts).
--
-- FORCE is required: the app connects to Neon as the table OWNER, and owners
-- bypass ordinary RLS. FORCE subjects the owner to the policy too, so isolation
-- holds for every connection.
--
-- NULLIF(...,'') guards against an empty-string GUC (''::uuid would error); an
-- unset GUC yields NULL -> `org_id = NULL` -> no rows (fail closed).
--
-- Platform-level tables (organizations, users, org_memberships) are NOT scoped
-- here by design: identity is shared across orgs (CLAUDE.md cardinal rule #5).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'contacts', 'projects', 'project_links', 'introductions',
    'meetings', 'meeting_attendees', 'action_items', 'invoices', 'payments',
    'news_items', 'activities', 'integration_credentials'
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
