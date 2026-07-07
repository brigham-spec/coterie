// Normalize the projects.stage column to the canonical pipeline vocabulary
// (src/lib/project-stages.ts). The item-8 HVEDC migration collapsed the demo's
// fine-grained stages into coarse open/active/on_hold, but preserved the real
// stage in each project's stage_history JSON. This backfills stage from the LAST
// stage_history entry, restoring the intended pipeline as first-class data.
//
// Fully reversible: stage_history is left untouched, so the derivation can be
// re-run at any time. DRY-RUN by default (prints the plan); pass --apply to
// COMMIT. Runs as app_user (DATABASE_URL) inside a withOrg-equivalent tx
// (set_config app.org_id) so RLS is exercised, not bypassed.
//
//   node scripts/normalize-project-stages.mjs           # dry-run
//   node scripts/normalize-project-stages.mjs --apply    # write

import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const ORG = "f0000000-0000-4000-8000-000000000001"; // HVEDC seed org (item 8).

// Prototype stage labels -> canonical snake_case values.
const LABEL_TO_VALUE = new Map([
  ["Concept", "concept"],
  ["Pre-Development", "pre_development"],
  ["Entitlements", "entitlements"],
  ["Planning Board", "planning_board"],
  ["Capital Raise", "capital_raise"],
  ["Construction Docs", "construction_docs"],
  ["Under Construction", "under_construction"],
  ["Stabilization", "stabilization"],
  ["Completed", "completed"],
  ["On Hold", "on_hold"],
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
const warnings = [];

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.org_id', $1, true)", [ORG]);

  const { rows } = await client.query(
    "SELECT id, name, stage, stage_history FROM projects",
  );

  for (const r of rows) {
    const history = Array.isArray(r.stage_history) ? r.stage_history : [];
    const lastLabel = history.length ? history[history.length - 1].stage : null;
    const target = lastLabel ? LABEL_TO_VALUE.get(lastLabel) : undefined;

    if (!target) {
      warnings.push(
        `"${r.name}": no usable stage_history (last=${JSON.stringify(lastLabel)}) → left as "${r.stage}"`,
      );
      unchanged++;
      continue;
    }
    if (target === r.stage) {
      unchanged++;
      continue;
    }

    console.log(`  ${r.name}: ${r.stage} → ${target}`);
    if (APPLY) {
      await client.query(
        "UPDATE projects SET stage = $1, updated_at = now() WHERE id = $2",
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
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
