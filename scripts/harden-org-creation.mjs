// Harden a Clerk instance against client-side tenant creation, and set the
// per-org membership cap. Tenants are operator-provisioned (scripts/create-org.mjs);
// a client-created Clerk org would lazily provision a brand-new Postgres tenant
// with default packaging, bypassing module control.
//
// Two levers, because the Clerk Backend API does NOT expose the instance-wide
// "Allow users to create organizations" toggle (only `enabled`, which disables
// Organizations entirely — wrong). This script covers what the API CAN do:
//   1. Set createOrganizationEnabled=false on every EXISTING user.
//   2. Set the per-org membership cap (maxAllowedMemberships).
// The instance-wide DEFAULT for FUTURE users is dashboard-only:
//   Clerk Dashboard > Configure > Organization management >
//   "Allow users to create organizations" = OFF.
// Flip that too, or new invitees regain creation rights. This script + that
// toggle + the hidden UI button (dashboard/layout.tsx) keep all three in agreement.
//
// Runs against whatever CLERK_SECRET_KEY is in .env — so to harden the PRODUCTION
// instance, first swap .env to the pk_live/sk_live keys, then run with --apply.
//
// DRY-RUN by default (prints the plan, mutates nothing); pass --apply to COMMIT.
//   node scripts/harden-org-creation.mjs                       # dry-run
//   node scripts/harden-org-creation.mjs --apply               # commit
//   node scripts/harden-org-creation.mjs --max-memberships 250 --apply

import { readFileSync } from "node:fs";
import { createClerkClient } from "@clerk/backend";

const APPLY = process.argv.includes("--apply");
const maxArgIdx = process.argv.indexOf("--max-memberships");
const MAX_MEMBERSHIPS =
  maxArgIdx !== -1 ? Number(process.argv[maxArgIdx + 1]) : 100;
if (!Number.isInteger(MAX_MEMBERSHIPS) || MAX_MEMBERSHIPS < 1) {
  console.error("--max-memberships must be a positive integer");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
if (!env.CLERK_SECRET_KEY) {
  console.error("Missing CLERK_SECRET_KEY in .env");
  process.exit(1);
}

// Which instance is this key pointing at? (test = dev instance, live = prod.)
const mode = env.CLERK_SECRET_KEY.startsWith("sk_live_")
  ? "LIVE (production instance)"
  : env.CLERK_SECRET_KEY.startsWith("sk_test_")
    ? "TEST (development instance)"
    : "UNKNOWN";
console.log(`Clerk key mode: ${mode}`);

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

// 1) Disable client-side org creation for every existing user (idempotent).
let offset = 0;
const limit = 100;
let total = Infinity;
let toDisable = 0;
let alreadyOff = 0;
while (offset < total) {
  const page = await clerk.users.getUserList({ limit, offset });
  total = page.totalCount;
  if (page.data.length === 0) break;
  for (const u of page.data) {
    const who = u.primaryEmailAddress?.emailAddress ?? u.id;
    if (u.createOrganizationEnabled === false) {
      alreadyOff++;
      continue;
    }
    toDisable++;
    console.log(`  ${APPLY ? "disabling" : "would disable"} create-org for ${who}`);
    if (APPLY) {
      await clerk.users.updateUser(u.id, { createOrganizationEnabled: false });
    }
  }
  offset += page.data.length;
}
console.log(`Users: ${toDisable} ${APPLY ? "disabled" : "to disable"}, ${alreadyOff} already off (total ${total}).`);

// 2) Set the per-org membership cap.
const before = await clerk.instance.getOrganizationSettings();
console.log(`maxAllowedMemberships: ${before.maxAllowedMemberships} -> ${MAX_MEMBERSHIPS}`);
if (APPLY && before.maxAllowedMemberships !== MAX_MEMBERSHIPS) {
  await clerk.instance.updateOrganizationSettings({
    maxAllowedMemberships: MAX_MEMBERSHIPS,
  });
}

if (!APPLY) {
  console.log("\nDRY-RUN: nothing changed. Re-run with --apply to commit.");
} else {
  console.log("\nDone. Remember the dashboard toggle for FUTURE users (see header).");
}
