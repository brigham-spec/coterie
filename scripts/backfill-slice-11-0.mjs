// Slice 11.0 backfill — populate the new columns on the existing HVEDC demo data.
//
// Runs AFTER the 20260706000000_slice_11_0_data_model migration. Purely additive:
// UPDATEs existing rows (companies/contacts/projects) with the rich fields, and
// upserts project_links roles from the source `team`/`developerMemberId`. It does
// NOT insert or delete member/contact/project rows — item-8's migration owns those.
//
// Re-reads the SAME source backup as item-8 and re-derives item-8's dedup keys
// (normalized org name for companies; emailKey||norm(name) within a company for
// contacts; normalized name for projects) to MATCH the already-loaded rows by
// natural key — never by regenerated uuids. Idempotent: every write is a
// deterministic UPDATE/upsert, safe to re-run.
//
// CRITICAL FIX: item-8 collapsed `active` and `onboard` members both to
// status=member and dropped the Director/Advisory tier. This restores it:
//   active  -> tier "Director Level"
//   onboard -> tier "Advisory Level"
// keyed to the SAME first-member-per-org that item-8 used to set company.status,
// so tier stays consistent with the stored status.
//
// Runtime: plain `pg` (like migrate-hvedc.mjs), connecting as app_user
// (DATABASE_URL, NOBYPASSRLS) inside a withOrg-style tx so RLS is proven here too.
//
//   node scripts/backfill-slice-11-0.mjs [--file <backup.json>]   # dry-run (default)
//   node scripts/backfill-slice-11-0.mjs --apply [--file <backup.json>]

import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const HVEDC_ORG_ID = "f0000000-0000-4000-8000-000000000001";
const DEFAULT_BACKUP = "/Users/brighamfarrand/Desktop/Coterie_backup_2026-05-30.json";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fileArg = args.indexOf("--file");
const BACKUP_PATH = fileArg !== -1 ? args[fileArg + 1] : DEFAULT_BACKUP;

// ── load + parse (mirrors migrate-hvedc.mjs: values are JSON strings) ─────────
const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
const store = raw.data ?? raw;
const read = (k) => {
  let v = store[k];
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
};

const members = (read("hvedc_crm_members")?.members ?? []).filter(Boolean);
const srcProjects = (read("hvedc_projects") ?? []).filter(Boolean);
const srcInvoices = read("hvedc_invoice_schedule") ?? [];

// ── helpers (identical semantics to migrate-hvedc.mjs so keys line up) ────────
const warnings = [];
const warn = (m) => warnings.push(m);
const norm = (s) => (s || "").trim().toLowerCase();
const cleanEmail = (e) => {
  if (!e || typeof e !== "string") return null;
  const c = e.replace(/[<>]/g, "").trim();
  return c || null;
};
const emailKey = (e) => (cleanEmail(e) || "").toLowerCase();
const isoDate = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
};
const nz = (v) => {
  // non-empty string / non-empty array / finite non-zero number, else null
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return v.length ? v : null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return v;
};
const camelToSnake = (s) => s.replace(/([A-Z])/g, "_$1").toLowerCase();
// Source arrays are inconsistent: some fields are real arrays (networkTags,
// contact tags), others are comma/semicolon-separated strings (counties). Coerce
// to a clean string[] for text[] columns; return null when empty (so COALESCE
// leaves the existing value untouched).
const toStrArray = (v) => {
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string") arr = v.split(/[,;]/);
  else return null;
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  return out.length ? out : null;
};
const tierFromSt = (st) => ({ active: "Director Level", onboard: "Advisory Level" })[st] ?? null;

// invoice_schedule: org (normalized) -> memberSince
const memberSinceByOrg = new Map();
for (const inv of srcInvoices) {
  const k = norm(inv.org);
  if (k && inv.memberSince && !memberSinceByOrg.has(k)) memberSinceByOrg.set(k, Number(inv.memberSince));
}

// ── company-level aggregation, replaying item-8's first-member-wins dedup ─────
// firstStByOrg drives tier (must match how status was set). Other fields take the
// first NON-EMPTY value across all members sharing the org (best data recovery).
const firstStByOrg = new Map();
const companyAgg = new Map(); // orgNorm -> field bag
const takeFirst = (bag, key, val) => {
  const v = nz(val);
  if (v != null && bag[key] == null) bag[key] = v;
};
for (const m of members) {
  const orgName = (m.o || "").trim();
  if (!orgName) continue; // item-8 skipped these; nothing to backfill
  const k = norm(orgName);
  if (!firstStByOrg.has(k)) firstStByOrg.set(k, m.st);
  let bag = companyAgg.get(k);
  if (!bag) { bag = { services: null, lastContact: null }; companyAgg.set(k, bag); }
  if (bag.counties == null) bag.counties = toStrArray(m.counties);
  takeFirst(bag, "dealSize", m.dealSize);
  takeFirst(bag, "lookingFor", m.lookingFor);
  takeFirst(bag, "canOffer", m.canOffer);
  takeFirst(bag, "agencyContacts", m.agencyContacts);
  if (bag.networkTags == null) bag.networkTags = toStrArray(m.networkTags);
  if (bag.services == null && m.services && Object.keys(m.services).length) bag.services = m.services;
  // lastContact: keep the max (most recent) across the org's members.
  const lc = isoDate(m.lastContact);
  if (lc && (!bag.lastContact || lc > bag.lastContact)) bag.lastContact = lc;
  if (m.owner) bag._hasOwner = true; // counted as a warning (name, not a user id)
}

// ── contact-level: linkedin + tags keyed by (orgNorm, emailKey||n:name) ───────
// Mirrors item-8's within-company dedup key so we match the exact stored row.
const contactSrc = new Map(); // `${orgNorm}::${dedup}` -> { linkedin, tags }
const addContactSrc = (orgNorm, name, email, linkedin, tags) => {
  const nm = (name || "").trim();
  if (!nm) return;
  const dedup = emailKey(email) || `n:${norm(nm)}`;
  const key = `${orgNorm}::${dedup}`;
  const cur = contactSrc.get(key) || {};
  if (linkedin && !cur.linkedin) cur.linkedin = linkedin.trim();
  if (!cur.tags) { const t = toStrArray(tags); if (t) cur.tags = t; }
  if (Object.keys(cur).length) contactSrc.set(key, cur);
};
for (const m of members) {
  const orgNorm = norm(m.o);
  if (!orgNorm) continue;
  addContactSrc(orgNorm, m.c, m.email, m.linkedin, null); // primary
  for (const c of m.contacts || []) {
    if (!c) continue;
    addContactSrc(orgNorm, c.name, c.email, c.linkedin, c.tags);
  }
}

// ── project-level: flat/JSON fields keyed by normalized name ──────────────────
const projectSrc = new Map(); // nameNorm -> {type,county,units,realizedValue,economicImpact,hvServices,stageHistory, teamRoles:[{memberId,role}]}
for (const p of srcProjects) {
  const key = norm(p.name || "Untitled project");
  const rv = Number(p.realizedValue);
  const teamRoles = [];
  if (p.developerMemberId) teamRoles.push({ memberId: p.developerMemberId, role: "developer" });
  for (const [role, v] of Object.entries(p.team || {})) {
    if (v && v.memberId) teamRoles.push({ memberId: v.memberId, role: camelToSnake(role) });
  }
  projectSrc.set(key, {
    type: nz(p.type) || nz(p.industry),
    county: nz(p.county),
    units: Number.isFinite(Number(p.units)) && Number(p.units) > 0 ? Number(p.units) : null,
    realizedValue: Number.isFinite(rv) && rv > 0 ? rv : null,
    economicImpact: p.economicImpact && Object.keys(p.economicImpact).length ? p.economicImpact : null,
    hvServices: p.hvServices && Object.keys(p.hvServices).length ? p.hvServices : null,
    stageHistory: Array.isArray(p.stageHistory) && p.stageHistory.length ? p.stageHistory : null,
    teamRoles,
  });
}

// member id -> org (normalized) so team memberIds resolve to a company
const orgByMemberId = new Map();
for (const m of members) if (m.o) orgByMemberId.set(m.id, norm(m.o));

// ── report the plan ───────────────────────────────────────────────────────────
const ownerSkipped = [...companyAgg.values()].filter((b) => b._hasOwner).length;
const tierCounts = { "Director Level": 0, "Advisory Level": 0 };
for (const st of firstStByOrg.values()) { const t = tierFromSt(st); if (t) tierCounts[t]++; }
console.log(`\nSlice 11.0 backfill — ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Backup: ${BACKUP_PATH}`);
console.log(`Seed org: ${HVEDC_ORG_ID}\n`);
console.log("Source-side plan:");
console.log(`  companies to enrich:        ${companyAgg.size}`);
console.log(`  tier restore Director/Adv:  ${tierCounts["Director Level"]} / ${tierCounts["Advisory Level"]}`);
console.log(`  contacts w/ linkedin|tags:  ${contactSrc.size}`);
console.log(`  projects to enrich:         ${projectSrc.size}`);
console.log(`  ownerUserId skipped (name): ${ownerSkipped}  (source owner is a display name, not a user id)`);

if (!APPLY) {
  console.log(`\nDry run only — nothing written. Re-run with --apply to commit.\n`);
  process.exit(0);
}

// ── apply ─────────────────────────────────────────────────────────────────────
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is not set — aborting."); process.exit(1); }

const client = new pg.Client({ connectionString });
await client.connect();
const stats = { companies: 0, tiers: 0, contacts: 0, projects: 0, roles: 0 };
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [HVEDC_ORG_ID]);

  // Load existing rows for this org (RLS-scoped) and match by natural key.
  const dbCompanies = (await client.query(`SELECT id, name FROM companies WHERE org_id = $1`, [HVEDC_ORG_ID])).rows;
  const companyIdByOrg = new Map(dbCompanies.map((c) => [norm(c.name), c.id]));

  const dbContacts = (await client.query(
    `SELECT id, name, email, company_id FROM contacts WHERE org_id = $1`, [HVEDC_ORG_ID],
  )).rows;
  // key: `${company_id}::${emailKey||n:name}` — the same dedup identity item-8 used.
  const contactIdByKey = new Map();
  for (const c of dbContacts) {
    const dedup = emailKey(c.email) || `n:${norm(c.name)}`;
    contactIdByKey.set(`${c.company_id}::${dedup}`, c.id);
  }

  const dbProjects = (await client.query(`SELECT id, name FROM projects WHERE org_id = $1`, [HVEDC_ORG_ID])).rows;
  const projectIdByName = new Map(dbProjects.map((p) => [norm(p.name), p.id]));

  // 1) Companies — enrich + restore tier.
  for (const [orgNorm, bag] of companyAgg) {
    const companyId = companyIdByOrg.get(orgNorm);
    if (!companyId) { warn(`company for org "${orgNorm}" not found in DB → skipped`); continue; }
    const tier = tierFromSt(firstStByOrg.get(orgNorm)); // null unless active/onboard
    const memberSince = memberSinceByOrg.get(orgNorm) ?? null;
    const res = await client.query(
      `UPDATE companies SET
         counties = COALESCE($2, counties),
         deal_size = COALESCE($3, deal_size),
         looking_for = COALESCE($4, looking_for),
         can_offer = COALESCE($5, can_offer),
         agency_contacts = COALESCE($6, agency_contacts),
         network_tags = COALESCE($7, network_tags),
         member_since = COALESCE($8, member_since),
         last_contact_at = COALESCE($9::timestamptz, last_contact_at),
         services = CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb ELSE services END,
         tier = COALESCE($11, tier),
         updated_at = now()
       WHERE id = $1 AND org_id = $12`,
      [
        companyId,
        bag.counties ?? null,
        bag.dealSize ?? null,
        bag.lookingFor ?? null,
        bag.canOffer ?? null,
        bag.agencyContacts ?? null,
        bag.networkTags ?? null,
        memberSince,
        bag.lastContact ?? null,
        bag.services ? JSON.stringify(bag.services) : null,
        tier,
        HVEDC_ORG_ID,
      ],
    );
    stats.companies += res.rowCount;
    if (tier) stats.tiers += 1;
  }

  // 2) Contacts — linkedin + tags.
  for (const [key, val] of contactSrc) {
    const [orgNorm, dedup] = key.split("::");
    const companyId = companyIdByOrg.get(orgNorm);
    if (!companyId) continue;
    const contactId = contactIdByKey.get(`${companyId}::${dedup}`);
    if (!contactId) { warn(`contact key ${key} not found in DB → skipped`); continue; }
    const res = await client.query(
      `UPDATE contacts SET
         linkedin = COALESCE($2, linkedin),
         tags = COALESCE($3, tags),
         updated_at = now()
       WHERE id = $1 AND org_id = $4`,
      [contactId, val.linkedin ?? null, val.tags ?? null, HVEDC_ORG_ID],
    );
    stats.contacts += res.rowCount;
  }

  // 3) Projects — flat + JSON fields.
  for (const [nameNorm, p] of projectSrc) {
    const projectId = projectIdByName.get(nameNorm);
    if (!projectId) { warn(`project "${nameNorm}" not found in DB → skipped`); continue; }
    const res = await client.query(
      `UPDATE projects SET
         type = COALESCE($2, type),
         county = COALESCE($3, county),
         units = COALESCE($4, units),
         realized_value = COALESCE($5, realized_value),
         economic_impact = CASE WHEN $6::jsonb IS NOT NULL THEN $6::jsonb ELSE economic_impact END,
         hv_services = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE hv_services END,
         stage_history = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE stage_history END,
         updated_at = now()
       WHERE id = $1 AND org_id = $9`,
      [
        projectId,
        p.type, p.county, p.units, p.realizedValue,
        p.economicImpact ? JSON.stringify(p.economicImpact) : null,
        p.hvServices ? JSON.stringify(p.hvServices) : null,
        p.stageHistory ? JSON.stringify(p.stageHistory) : null,
        HVEDC_ORG_ID,
      ],
    );
    stats.projects += res.rowCount;

    // 3b) Team/developer roles -> project_links (upsert; expand the role vocab).
    for (const { memberId, role } of p.teamRoles) {
      const orgNorm = orgByMemberId.get(memberId);
      const companyId = orgNorm ? companyIdByOrg.get(orgNorm) : null;
      if (!companyId) { warn(`project "${nameNorm}" ${role}: member ${memberId} → no company, link skipped`); continue; }
      const upd = await client.query(
        `UPDATE project_links SET role = $4, updated_at = now()
         WHERE org_id = $1 AND project_id = $2 AND company_id = $3`,
        [HVEDC_ORG_ID, projectId, companyId, role],
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO project_links (org_id, project_id, company_id, role, created_at, updated_at)
           VALUES ($1,$2,$3,$4, now(), now())
           ON CONFLICT (project_id, company_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
          [HVEDC_ORG_ID, projectId, companyId, role],
        );
      }
      stats.roles += 1;
    }
  }

  await client.query("COMMIT");
  console.log(`\nApplied (one transaction):`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`\nWarnings: ${warnings.length}`);
  for (const w of warnings) console.log(`  • ${w}`);
  console.log("");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nBackfill failed — rolled back. No rows written.");
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
