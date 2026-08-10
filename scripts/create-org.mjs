// Onboard a new tenant: create the Clerk Organization and pre-seed its Postgres
// Organization row (name, org_type, settings.modules) so the tenant's module
// packaging is set BEFORE its admin first signs in. provisionOrg (src/lib/auth.ts)
// keys on clerk_id and returns an existing row untouched, so pre-seeding here is
// honored on first sign-in — the tenant lands with the right surface immediately,
// no operator round-trip through the Settings > Modules toggle.
//
// The operator (createdBy) becomes an org:admin automatically, so they can reach
// Settings for the tenant. Optionally invites the tenant's own admin by email.
//
// DRY-RUN by default (prints the plan, mutates nothing); pass --apply to COMMIT.
// This creates LIVE prod resources (a Clerk org + a DB row) — treat --apply like a
// deploy. The Clerk write uses CLERK_SECRET_KEY; the DB write uses DIRECT_URL
// (owner) since `organizations` carries no RLS. Re-running --apply with the same
// --name creates a SECOND Clerk org (Clerk does not dedupe names) but the DB row
// upserts by clerk_id, so guard against double-runs.
//
//   node scripts/create-org.mjs \
//     --name "Affinity Wealth Advisors" \
//     --org-type wealth \
//     --operator-email brigham@coterienmt.ai \
//     --drop projects \
//     [--admin-email someone@affinity.com] \
//     [--apply]
//
// --modules / --drop select which OPTIONAL modules are enabled:
//   (default)            all optional modules on
//   --drop a,b           all optional except a,b
//   --modules a,b        ONLY a,b (core modules are always on regardless)

import { readFileSync } from "node:fs";
import pg from "pg";
import { createClerkClient } from "@clerk/backend";

// Canonical OPTIONAL module keys, in nav order. MUST stay in lockstep with
// OPTIONAL_MODULES in src/lib/modules.ts (this is a plain .mjs script and can't
// import the TS registry). Core keys (dashboard/companies/contacts/introductions/
// settings) are always on and never stored, so they are intentionally absent.
const OPTIONAL_KEYS = [
  "revenue",
  "proposals",
  "projects",
  "commitments",
  "network_search",
  "prospect_finder",
  "news",
  "email",
  "events",
  "meetings",
  "invoices",
  "value_created",
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function list(name) {
  const v = arg(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

const APPLY = process.argv.includes("--apply");
const name = arg("name");
const orgType = arg("org-type");
const operatorEmail = arg("operator-email");
const adminEmail = arg("admin-email");
const only = list("modules");
const drop = list("drop");

if (!name || !orgType || !operatorEmail) {
  console.error(
    "Missing required args. Need --name, --org-type, --operator-email.\n" +
      "See the header of scripts/create-org.mjs for usage.",
  );
  process.exit(1);
}

// Resolve the enabled optional set, normalized to canonical order (mirrors
// normalizeModuleSelection): dropping core/unknown keys and de-duping.
const unknown = [...only, ...drop].filter((k) => !OPTIONAL_KEYS.includes(k));
if (unknown.length) {
  console.error(`Unknown module key(s): ${unknown.join(", ")}`);
  console.error(`Valid optional keys: ${OPTIONAL_KEYS.join(", ")}`);
  process.exit(1);
}
const enabled =
  only.length > 0
    ? OPTIONAL_KEYS.filter((k) => only.includes(k))
    : OPTIONAL_KEYS.filter((k) => !drop.includes(k));

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

if (!env.CLERK_SECRET_KEY || !env.DIRECT_URL) {
  console.error("Missing CLERK_SECRET_KEY or DIRECT_URL in .env");
  process.exit(1);
}

console.log("Plan:");
console.log(`  Org name       : ${name}`);
console.log(`  org_type       : ${orgType}`);
console.log(`  Operator (admin): ${operatorEmail}`);
console.log(`  Invite admin   : ${adminEmail ?? "(none)"}`);
console.log(`  Modules enabled: ${enabled.join(", ")}`);
console.log(
  `  Modules OFF    : ${OPTIONAL_KEYS.filter((k) => !enabled.includes(k)).join(", ") || "(none)"}`,
);

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

// The operator's Clerk user id — needed as createdBy so they land as org:admin.
const users = await clerk.users.getUserList({ emailAddress: [operatorEmail] });
const operator = users.data[0];
if (!operator) {
  console.error(`No Clerk user found with email ${operatorEmail}. They must have signed in at least once.`);
  process.exit(1);
}
console.log(`  Operator userId: ${operator.id}`);

if (!APPLY) {
  console.log("\nDRY-RUN: nothing was created. Re-run with --apply to commit.");
  process.exit(0);
}

const clerkOrg = await clerk.organizations.createOrganization({
  name,
  createdBy: operator.id,
  publicMetadata: { orgType },
});
console.log(`\nCreated Clerk org: ${clerkOrg.id}`);

const client = new pg.Client({ connectionString: env.DIRECT_URL });
await client.connect();
try {
  const { rows } = await client.query(
    `INSERT INTO organizations (id, clerk_id, name, org_type, settings, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, now(), now())
     ON CONFLICT (clerk_id) DO UPDATE
       SET name = EXCLUDED.name, org_type = EXCLUDED.org_type,
           settings = EXCLUDED.settings, updated_at = now()
     RETURNING id`,
    [clerkOrg.id, name, orgType, JSON.stringify({ modules: enabled })],
  );
  console.log(`Seeded Postgres org: ${rows[0].id}`);
} finally {
  await client.end();
}

if (adminEmail) {
  await clerk.organizations.createOrganizationInvitation({
    organizationId: clerkOrg.id,
    emailAddress: adminEmail,
    role: "org:admin",
    inviterUserId: operator.id,
  });
  console.log(`Invited ${adminEmail} as org:admin`);
}

console.log("\nDone. The tenant is provisioned with the module set above.");
