// Bootstrap the restricted application database role.
//
// WHY: Neon's owner role (neondb_owner) has the BYPASSRLS attribute, so every
// query it runs skips row-level security — tenant isolation would be silently
// inert. The app must therefore connect as a role WITHOUT bypassrls. Migrations
// keep using the owner (they need DDL and legitimately bypass RLS).
//
// This script is idempotent and contains NO secret: it reads the owner
// connection from DIRECT_URL and the app role's password from APP_DB_PASSWORD.
// Run it once per environment (local, CI, prod) after migrations:
//   DIRECT_URL=... APP_DB_PASSWORD=... node scripts/bootstrap-app-role.mjs
//
// Grants cover existing objects plus ALTER DEFAULT PRIVILEGES for objects the
// owner creates later, so future migrations don't require re-granting by hand.

import "dotenv/config";
import pg from "pg";

const ROLE = "app_user";
const ownerUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;

if (!ownerUrl) throw new Error("DIRECT_URL (owner connection) is required");
if (!password) throw new Error("APP_DB_PASSWORD is required");

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();

try {
  // CREATE/ALTER ROLE are utility statements and cannot take bind parameters,
  // so the password must be inlined as a SQL string literal. Escape any single
  // quotes (the generated password is hex, but escape defensively regardless).
  const pwLiteral = `'${password.replace(/'/g, "''")}'`;
  const { rowCount } = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [ROLE],
  );
  const verb = rowCount ? "ALTER" : "CREATE";
  await client.query(`${verb} ROLE ${ROLE} LOGIN NOBYPASSRLS PASSWORD ${pwLiteral}`);

  await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
  );
  // Future tables/sequences created by the owner (migrations) auto-grant.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
  );

  console.log(`Bootstrapped role "${ROLE}" (NOBYPASSRLS) with DML grants.`);
} finally {
  await client.end();
}
