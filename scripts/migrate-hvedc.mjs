// HVEDC demo-data migration (build-order item 8, spec §6).
//
// Ports the single-file prototype's localStorage backup into the multi-tenant
// Postgres schema, under ONE dedicated seed Organization (clerkId = null, like
// the isolation-test tenants). Honors the cardinal rule: every tenant row is
// stamped with the seed org_id and written INSIDE a withOrg-style transaction
// (SELECT set_config('app.org_id', …, true)) so RLS enforces the silo even here.
//
// Runtime: plain `pg` (no Prisma — Node's type-stripping can't import the
// generated client's extensionless modules). Connects as app_user (DATABASE_URL,
// NOBYPASSRLS) so the migration itself proves isolation holds.
//
//   node scripts/migrate-hvedc.mjs [--file <backup.json>]        # dry-run (default)
//   node scripts/migrate-hvedc.mjs --apply [--file <backup.json>]
//
// Idempotent: --apply deletes all tenant rows for the seed org, then re-inserts.
// Safe to re-run against the newest backup.

import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

// Fixed seed-org UUID — stable across runs so re-migration targets the same
// tenant. clerkId stays null (no Clerk org backs the demo data).
const HVEDC_ORG_ID = "f0000000-0000-4000-8000-000000000001";
const DEFAULT_BACKUP = "/Users/brighamfarrand/Desktop/Coterie_backup_2026-05-30.json";

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fileArg = args.indexOf("--file");
const BACKUP_PATH = fileArg !== -1 ? args[fileArg + 1] : DEFAULT_BACKUP;

// ── load + parse the backup ──────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
const store = raw.data ?? raw;
const read = (key) => {
  let v = store[key];
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

const settings = read("hvedc_settings") ?? {};
const members = (read("hvedc_crm_members")?.members ?? []).filter(Boolean);
const srcProjects = read("hvedc_projects") ?? [];
const srcInvoices = read("hvedc_invoice_schedule") ?? [];
const srcIntros = read("hvedc_intro_log") ?? [];
const srcMeetings = read("hvedc_member_meetings") ?? {};

// ── helpers ──────────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID();
const warnings = [];
const warn = (msg) => warnings.push(msg);

// Prototype emails are dirty (stray < > and whitespace, e.g. "jta@x.com>").
const cleanEmail = (e) => {
  if (!e || typeof e !== "string") return null;
  const c = e.replace(/[<>]/g, "").trim();
  return c || null;
};
const emailKey = (e) => (cleanEmail(e) || "").toLowerCase();
const domainOf = (e) => {
  const c = cleanEmail(e);
  const at = c ? c.indexOf("@") : -1;
  return at > 0 ? c.slice(at + 1).toLowerCase() : null;
};
const norm = (s) => (s || "").trim().toLowerCase();

// Relationship value: prototype stores thousands (v=20 → $20k); one row is
// already in dollars (20000). Normalize to dollars.
const toDollars = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1000 ? n : n * 1000;
};

const mapStatus = (st) =>
  ({ active: "member", onboard: "member", partner: "strategic_partner", prospect: "prospect", archived: "former" })[st] ??
  "prospect";

const mapProjectStage = (s) => {
  const t = norm(s);
  if (t === "under construction" || t === "construction docs") return "active";
  if (t === "on hold") return "on_hold";
  return "open"; // capital raise, planning board, pre-development, concept, entitlements
};

const mapIntroStatus = (stage) =>
  ({ made: "made", connected: "made", collaborating: "meeting_held", closed: "closed" })[norm(stage)] ?? "made";

// @db.Date column → 'YYYY-MM-DD'
const isoDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
};
// Membership-dues installment date: monthIndex is months since Jan of memberSince.
const installmentDate = (memberSince, monthIndex) =>
  isoDate(new Date(Date.UTC(Number(memberSince) || 2025, Number(monthIndex), 1)));

// ── build the entity graph ───────────────────────────────────────────────────
const companies = []; // {id,name,status,tier,temperature,industry,annualValue,website,emailDomain,source,notes}
const contacts = []; // {id,companyId,name,email,phone,title,isPrimary,notes}
const companyByOrg = new Map(); // normalized org name -> companyId
const companyByMemberId = new Map(); // member id -> companyId
const contactByMemberId = new Map(); // member id -> representative contactId (primary preferred)
const contactByEmail = new Map(); // clean lowercased email -> contactId (for meeting matching)

for (const m of members) {
  const orgName = (m.o || "").trim();
  if (!orgName) {
    warn(`member id=${m.id} (${m.c || "—"}) has no organization name → skipped (no company)`);
    continue;
  }
  const key = norm(orgName);
  let companyId = companyByOrg.get(key);
  if (!companyId) {
    companyId = uuid();
    companyByOrg.set(key, companyId);
    const primaryDomain = domainOf(m.email);
    companies.push({
      id: companyId,
      name: orgName,
      status: mapStatus(m.st),
      tier: null,
      temperature: typeof m.lk === "number" ? Math.round(m.lk) : null,
      industry: (m.ind || "").trim(),
      annualValue: toDollars(m.v),
      website: (m.website || "").trim() || null,
      emailDomain: primaryDomain,
      source: (m.src || "").trim() || null,
      notes: (m.notes || "").trim(),
    });
  } else {
    warn(`org "${orgName}" appears on multiple members → merged into one company (member id=${m.id} folded in as contact)`);
  }
  companyByMemberId.set(m.id, companyId);

  // Dedupe contacts within a company by email (falling back to name).
  const seen = new Set();
  const addContact = (name, email, phone, title, isPrimary, notes) => {
    const nm = (name || "").trim();
    if (!nm) return null;
    const dedupe = emailKey(email) || norm(nm);
    if (seen.has(dedupe)) return null;
    seen.add(dedupe);
    const ce = cleanEmail(email);
    const id = uuid();
    contacts.push({
      id,
      companyId,
      name: nm,
      email: ce,
      phone: (phone || "").trim() || null,
      title: (title || "").trim() || null,
      isPrimary,
      notes: (notes || "").trim(),
    });
    if (ce && !contactByEmail.has(emailKey(ce))) contactByEmail.set(emailKey(ce), id);
    return id;
  };

  const primaryId = addContact(m.c, m.email, m.phone, m.title, true, "");
  for (const c of m.contacts || []) {
    if (!c) continue;
    addContact(c.name, c.email, c.phone, c.title, false, c.notes);
  }
  // Representative contact for intro resolution: primary if present, else the
  // first contact created under this company for this member.
  const rep = primaryId ?? contacts.find((x) => x.companyId === companyId)?.id ?? null;
  if (rep && !contactByMemberId.has(m.id)) contactByMemberId.set(m.id, rep);
}

// ── projects + links ─────────────────────────────────────────────────────────
const projects = [];
const projectLinks = [];
const projectById = new Map(); // source project id -> our uuid
for (const p of srcProjects) {
  const id = uuid();
  projectById.set(p.id, id);
  const val = Number(p.value);
  projects.push({
    id,
    name: (p.name || "Untitled project").trim(),
    stage: mapProjectStage(p.stage),
    description: (p.description || "").trim(),
    value: Number.isFinite(val) && val > 0 ? val : null,
  });
  const linked = new Set();
  for (const mid of p.memberIds || []) {
    const companyId = companyByMemberId.get(mid);
    if (!companyId) {
      warn(`project "${p.name}" links member id=${mid} with no company → link skipped`);
      continue;
    }
    if (linked.has(companyId)) continue; // dedupe (project, company)
    linked.add(companyId);
    projectLinks.push({ projectId: id, companyId, role: "advisor" });
  }
}

// ── invoices + payments ──────────────────────────────────────────────────────
const invoices = [];
const payments = [];
for (const inv of srcInvoices) {
  const companyId = companyByOrg.get(norm(inv.org));
  if (!companyId) {
    warn(`invoice ${inv.id} org "${inv.org}" (${inv.name}) matched no company → skipped (with its payments)`);
    continue;
  }
  const schedule = inv.schedule || {};
  const paid = inv.paidMonths || {};
  for (const idx of Object.keys(schedule)) {
    const amount = Number(schedule[idx]) || 0;
    const invoiceId = uuid();
    const due = installmentDate(inv.memberSince, idx);
    invoices.push({
      id: invoiceId,
      companyId,
      invoiceNumber: `${inv.id}-${idx}`,
      amount,
      issuedOn: due,
      dueOn: due,
      status: "sent", // stored status only ever draft/sent/void; paid is derived
      notes: `${inv.cadence} membership dues`,
    });
    if (paid[idx]) {
      payments.push({
        id: uuid(),
        invoiceId,
        amount,
        receivedOn: isoDate(new Date(Number(paid[idx]))),
        method: null,
      });
    }
  }
}

// ── introductions ────────────────────────────────────────────────────────────
const introductions = [];
for (const x of srcIntros) {
  const a = x.memberAId != null ? contactByMemberId.get(x.memberAId) : null;
  const b = x.memberBId != null ? contactByMemberId.get(x.memberBId) : null;
  if (!a || !b) {
    warn(`intro ${x.id} (${x.memberAName || "?"} ↔ ${x.memberBName || "?"}) has an unresolved party → skipped`);
    continue;
  }
  if (a === b) {
    warn(`intro ${x.id} resolves both parties to the same contact → skipped`);
    continue;
  }
  introductions.push({
    id: uuid(),
    partyAContactId: a,
    partyBContactId: b,
    status: mapIntroStatus(x.stage),
    source: "manual",
    outcome: (x.outcome || "").trim() || null,
    madeOn: x.madeAt ? isoDate(new Date(Number(x.madeAt))) : null,
    projectId: null,
    notes: [x.headline, x.notes].filter(Boolean).join("\n\n").trim(),
  });
}

// ── meetings + attendees (dedupe by prototype meeting id across members) ──────
const meetingMap = new Map(); // source meeting id -> {id,title,heldAt,summary,participants:Set}
for (const memberId of Object.keys(srcMeetings)) {
  for (const meet of srcMeetings[memberId] || []) {
    if (!meet?.id) continue;
    let entry = meetingMap.get(meet.id);
    if (!entry) {
      entry = {
        id: uuid(),
        title: (meet.title || "Meeting").trim(),
        heldAt: meet.date ? new Date(`${meet.date}T12:00:00Z`).toISOString() : new Date().toISOString(),
        summary: (meet.summary || "").trim() || null,
        participants: new Set(),
      };
      meetingMap.set(meet.id, entry);
    }
    for (const p of meet.participants || []) {
      const k = emailKey(p);
      if (k) entry.participants.add(k);
    }
  }
}
const meetings = [];
const meetingAttendees = [];
for (const entry of meetingMap.values()) {
  meetings.push({ id: entry.id, title: entry.title, heldAt: entry.heldAt, summary: entry.summary });
  const attended = new Set();
  for (const k of entry.participants) {
    const contactId = contactByEmail.get(k);
    if (!contactId || attended.has(contactId)) continue;
    attended.add(contactId);
    meetingAttendees.push({ meetingId: entry.id, contactId, matchMethod: "email", confidence: 1, confirmed: true });
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const counts = {
  companies: companies.length,
  contacts: contacts.length,
  projects: projects.length,
  project_links: projectLinks.length,
  invoices: invoices.length,
  payments: payments.length,
  introductions: introductions.length,
  meetings: meetings.length,
  meeting_attendees: meetingAttendees.length,
};

console.log(`\nHVEDC migration — ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Backup: ${BACKUP_PATH}`);
console.log(`Seed org: ${settings.orgName || "HVEDC"} (${HVEDC_ORG_ID}, clerkId=null, orgType=edc)\n`);
console.log("Rows to write:");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${v}`);
const billed = invoices.reduce((a, i) => a + i.amount, 0);
const collected = payments.reduce((a, p) => a + p.amount, 0);
console.log(`\nBilled (sum invoices):   $${billed.toLocaleString()}`);
console.log(`Collected (sum payments): $${collected.toLocaleString()}`);
console.log(`\nData-quality warnings: ${warnings.length}`);
for (const w of warnings) console.log(`  • ${w}`);

if (!APPLY) {
  console.log(`\nDry run only — nothing written. Re-run with --apply to commit.\n`);
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────────
const NOW = "now()";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — aborting.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");

  // Organization is platform-level (non-RLS): upsert the seed tenant directly.
  await client.query(
    `INSERT INTO organizations (id, clerk_id, name, org_type, settings, created_at, updated_at)
     VALUES ($1, NULL, $2, 'edc', '{}'::jsonb, ${NOW}, ${NOW})
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = ${NOW}`,
    [HVEDC_ORG_ID, settings.orgName || "Hudson Valley Economic Development Corporation"],
  );

  // Enter the tenant: every subsequent tenant-table write is RLS-scoped to this org.
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [HVEDC_ORG_ID]);

  // Idempotency: clear existing tenant rows for this org (FK-safe order). RLS
  // already limits these to our org; the explicit WHERE is belt-and-suspenders.
  for (const t of [
    "payments",
    "invoices",
    "meeting_attendees",
    "meetings",
    "action_items",
    "introductions",
    "project_links",
    "projects",
    "contacts",
    "companies",
    "news_items",
    "activities",
  ]) {
    await client.query(`DELETE FROM ${t} WHERE org_id = $1`, [HVEDC_ORG_ID]);
  }

  const O = HVEDC_ORG_ID;
  for (const c of companies) {
    await client.query(
      `INSERT INTO companies (id, org_id, name, status, tier, temperature, industry, annual_value, website, email_domain, source, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,${NOW},${NOW})`,
      [c.id, O, c.name, c.status, c.tier, c.temperature, c.industry, c.annualValue, c.website, c.emailDomain, c.source, c.notes],
    );
  }
  for (const c of contacts) {
    await client.query(
      `INSERT INTO contacts (id, org_id, company_id, name, email, phone, title, is_primary, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${NOW},${NOW})`,
      [c.id, O, c.companyId, c.name, c.email, c.phone, c.title, c.isPrimary, c.notes],
    );
  }
  for (const p of projects) {
    await client.query(
      `INSERT INTO projects (id, org_id, name, stage, description, value, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,${NOW},${NOW})`,
      [p.id, O, p.name, p.stage, p.description, p.value],
    );
  }
  for (const l of projectLinks) {
    await client.query(
      `INSERT INTO project_links (org_id, project_id, company_id, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,${NOW},${NOW})`,
      [O, l.projectId, l.companyId, l.role],
    );
  }
  for (const i of invoices) {
    await client.query(
      `INSERT INTO invoices (id, org_id, company_id, invoice_number, amount, issued_on, due_on, status, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${NOW},${NOW})`,
      [i.id, O, i.companyId, i.invoiceNumber, i.amount, i.issuedOn, i.dueOn, i.status, i.notes],
    );
  }
  for (const p of payments) {
    await client.query(
      `INSERT INTO payments (id, org_id, invoice_id, amount, received_on, method, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,${NOW},${NOW})`,
      [p.id, O, p.invoiceId, p.amount, p.receivedOn, p.method],
    );
  }
  for (const x of introductions) {
    await client.query(
      `INSERT INTO introductions (id, org_id, party_a_contact_id, party_b_contact_id, status, source, outcome, made_on, project_id, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${NOW},${NOW})`,
      [x.id, O, x.partyAContactId, x.partyBContactId, x.status, x.source, x.outcome, x.madeOn, x.projectId, x.notes],
    );
  }
  for (const m of meetings) {
    await client.query(
      `INSERT INTO meetings (id, org_id, fireflies_id, title, held_at, summary, transcript_url, created_at, updated_at)
       VALUES ($1,$2,NULL,$3,$4,$5,NULL,${NOW},${NOW})`,
      [m.id, O, m.title, m.heldAt, m.summary],
    );
  }
  for (const a of meetingAttendees) {
    await client.query(
      `INSERT INTO meeting_attendees (org_id, meeting_id, contact_id, match_method, confidence, confirmed, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,${NOW},${NOW})`,
      [O, a.meetingId, a.contactId, a.matchMethod, a.confidence, a.confirmed],
    );
  }

  await client.query("COMMIT");
  console.log(`\nApplied. Committed all rows in one transaction.\n`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("\nMigration failed — rolled back. No rows written.");
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
