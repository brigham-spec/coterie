// Normalize the introductions.status column to the canonical lifecycle
// vocabulary (src/lib/intro-stages.ts). The pre-11.4 vocabulary was
// suggested/drafted/made/meeting_held/closed; slice 11.4a adopts the prototype's
// intro-log lifecycle, where meeting_held becomes meeting_set and closed becomes
// dormant. Canonical values pass through unchanged, so this is idempotent.
//
// DRY-RUN by default (prints the plan); pass --apply to COMMIT. Runs as app_user
// (DATABASE_URL) inside a withOrg-equivalent tx (set_config app.org_id) so RLS is
// exercised, not bypassed. Fully reversible (the map is a small, known rename).
//
//   node scripts/normalize-intro-stages.mjs           # dry-run
//   node scripts/normalize-intro-stages.mjs --apply    # write

import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const ORG = "f0000000-0000-4000-8000-000000000001"; // HVEDC seed org (item 8).

// Legacy status value -> canonical lifecycle value (mirrors normalizeIntroStatus).
const LEGACY_TO_CANONICAL = new Map([
  ["meeting_held", "meeting_set"],
  ["closed", "dormant"],
]);

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();

let updated = 0;
let unchanged = 0;

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.org_id', $1, true)", [ORG]);

  const { rows } = await client.query(
    "SELECT id, status FROM introductions",
  );

  for (const r of rows) {
    const target = LEGACY_TO_CANONICAL.get(r.status);
    if (!target) {
      unchanged++;
      continue;
    }
    console.log(`  ${r.id}: ${r.status} → ${target}`);
    if (APPLY) {
      await client.query(
        "UPDATE introductions SET status = $1, updated_at = now() WHERE id = $2",
        [target, r.id],
      );
    }
    updated++;
  }

  if (APPLY) {
    await client.query("COMMIT");
    console.log(`\nAPPLIED: ${updated} updated, ${unchanged} unchanged.`);
  } else {
    await client.query("ROLLBACK");
    console.log(`\nDRY-RUN: ${updated} would change, ${unchanged} unchanged.`);
  }
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
