import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { withOrg } from "@/lib/tenant";
import { EXPORT_VERSION, type TenantExport } from "@/lib/tenant-export";

// Tenant data restore — the inverse of @/lib/tenant-export. Replays a versioned
// export envelope into a DIFFERENT, EMPTY organization (operator re-homing a
// tenant, or seeding a fresh org from a backup). Runs inside one withOrg
// transaction, so RLS pins every insert to the target org.
//
// Row ids are FRESHLY REGENERATED, not preserved. Every id in the schema is a
// globally-unique primary key (and meetings.fireflies_id is globally unique
// too), so restoring the original ids would collide the moment the SOURCE org
// still exists — the common portability/clone case. We therefore mint a new
// uuid per row and rewrite every foreign key through the same old→new maps, so
// the copied graph is internally consistent while sharing nothing with the
// source. The only precondition is that the target org is empty.
//
// Three edges the rewrite must reconcile:
//   1. Platform-user references (owner_user_id / actor_user_id) point at the
//      Clerk-owned `users` table, which is never exported — those users don't
//      exist in the target's world, so we null the columns (all SetNull FKs).
//   2. Self-references (companies.referred_by_id, invoices.parent_invoice_id)
//      point back into their own table; a plain FK check can fail mid-insert
//      before the referenced row lands. We insert them nulled, then restore the
//      (remapped) value in a second pass once every row exists.
//   3. meetings.fireflies_id is a global sync-idempotency key; a copy is not the
//      same synced entity, so it is dropped to null to avoid a global collision.

type BulkDelegate = {
  count: () => Promise<number>;
  createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  update: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

// A foreign-key column and the table whose id-map resolves it.
type FkRef = { field: string; target: string };

type ImportStep = {
  name: string;
  delegate: (tx: Prisma.TransactionClient) => BulkDelegate;
  // Composite-PK junctions (meeting_attendees) have no standalone id to remap —
  // their key is made of the foreign keys, which we rewrite anyway.
  compositePk?: boolean;
  // FKs to other exported tables, rewritten through that table's id-map.
  fkRefs?: readonly FkRef[];
  // Columns nulled on insert AND for good: platform-user FKs, plus fireflies_id.
  nullFields?: readonly string[];
  // Self-referential FKs: nulled on insert, then restored (remapped) afterward.
  selfRefs?: readonly string[];
};

// Insert order: a parent is always created before anything that references it.
// Table names match EXPORT_TABLE_NAMES so the two files describe the same set.
const INSERT_PLAN: readonly ImportStep[] = [
  {
    name: "companies",
    delegate: (tx) => tx.company as unknown as BulkDelegate,
    nullFields: ["ownerUserId"],
    selfRefs: ["referredById"],
  },
  {
    name: "contacts",
    delegate: (tx) => tx.contact as unknown as BulkDelegate,
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "projects",
    delegate: (tx) => tx.project as unknown as BulkDelegate,
    fkRefs: [{ field: "developerMemberId", target: "companies" }],
  },
  {
    name: "events",
    delegate: (tx) => tx.event as unknown as BulkDelegate,
    fkRefs: [{ field: "projectId", target: "projects" }],
  },
  {
    name: "projectLinks",
    delegate: (tx) => tx.projectLink as unknown as BulkDelegate,
    fkRefs: [
      { field: "projectId", target: "projects" },
      { field: "companyId", target: "companies" },
      { field: "contactId", target: "contacts" },
    ],
  },
  {
    name: "fundingSources",
    delegate: (tx) => tx.fundingSource as unknown as BulkDelegate,
    fkRefs: [{ field: "projectId", target: "projects" }],
  },
  {
    name: "meetings",
    delegate: (tx) => tx.meeting as unknown as BulkDelegate,
    nullFields: ["firefliesId"],
  },
  {
    name: "introductions",
    delegate: (tx) => tx.introduction as unknown as BulkDelegate,
    fkRefs: [
      { field: "partyAContactId", target: "contacts" },
      { field: "partyBContactId", target: "contacts" },
      { field: "projectId", target: "projects" },
      { field: "eventId", target: "events" },
    ],
  },
  {
    name: "meetingAttendees",
    delegate: (tx) => tx.meetingAttendee as unknown as BulkDelegate,
    compositePk: true,
    fkRefs: [
      { field: "meetingId", target: "meetings" },
      { field: "contactId", target: "contacts" },
    ],
  },
  {
    name: "actionItems",
    delegate: (tx) => tx.actionItem as unknown as BulkDelegate,
    nullFields: ["ownerUserId"],
    fkRefs: [
      { field: "meetingId", target: "meetings" },
      { field: "projectId", target: "projects" },
      { field: "companyId", target: "companies" },
      { field: "eventId", target: "events" },
      { field: "ownerContactId", target: "contacts" },
    ],
  },
  {
    name: "invoices",
    delegate: (tx) => tx.invoice as unknown as BulkDelegate,
    selfRefs: ["parentInvoiceId"],
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "payments",
    delegate: (tx) => tx.payment as unknown as BulkDelegate,
    fkRefs: [{ field: "invoiceId", target: "invoices" }],
  },
  {
    name: "newsItems",
    delegate: (tx) => tx.newsItem as unknown as BulkDelegate,
    fkRefs: [
      { field: "companyId", target: "companies" },
      { field: "projectId", target: "projects" },
    ],
  },
  {
    name: "emailMessages",
    delegate: (tx) => tx.emailMessage as unknown as BulkDelegate,
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "activities",
    delegate: (tx) => tx.activity as unknown as BulkDelegate,
    nullFields: ["actorUserId"],
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "eventInvitees",
    delegate: (tx) => tx.eventInvitee as unknown as BulkDelegate,
    fkRefs: [
      { field: "eventId", target: "events" },
      { field: "contactId", target: "contacts" },
    ],
  },
  {
    name: "eventConversions",
    delegate: (tx) => tx.eventConversion as unknown as BulkDelegate,
    fkRefs: [
      { field: "eventId", target: "events" },
      { field: "companyId", target: "companies" },
    ],
  },
  {
    name: "membershipProposals",
    delegate: (tx) => tx.membershipProposal as unknown as BulkDelegate,
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "valueDelivered",
    delegate: (tx) => tx.valueDelivered as unknown as BulkDelegate,
    fkRefs: [
      { field: "companyId", target: "companies" },
      { field: "introductionId", target: "introductions" },
    ],
  },
  {
    name: "notes",
    delegate: (tx) => tx.note as unknown as BulkDelegate,
    nullFields: ["actorUserId"],
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "affiliations",
    delegate: (tx) => tx.affiliation as unknown as BulkDelegate,
    fkRefs: [{ field: "companyId", target: "companies" }],
  },
  {
    name: "keyRelationships",
    delegate: (tx) => tx.keyRelationship as unknown as BulkDelegate,
    fkRefs: [
      { field: "companyId", target: "companies" },
      { field: "linkedCompanyId", target: "companies" },
    ],
  },
];

// The tables restore touches — exported so a test can assert it stays in lockstep
// with the export's table set.
export const IMPORT_TABLE_NAMES: readonly string[] = INSERT_PLAN.map((s) => s.name);

export type ImportSummary = {
  targetOrgId: string;
  imported: Record<string, number>;
  total: number;
};

type Row = Record<string, unknown>;
type IdMap = Map<string, string>;

function rowsFor(data: TenantExport, name: string): Row[] {
  const rows = data.tables[name];
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

// Resolve an old id to its freshly-minted replacement. A same-tenant export
// always contains every referenced row, so a miss means the file is corrupt —
// fail loudly rather than write a dangling reference.
function remap(map: IdMap | undefined, oldId: unknown, target: string): string {
  const next = map?.get(String(oldId));
  if (next == null) {
    throw new Error(`unmapped ${target} reference: ${String(oldId)}`);
  }
  return next;
}

/**
 * Restore an export into an empty target organization.
 *
 * Throws if the version doesn't match this build, or if the target already holds
 * any data (restore never merges into a live tenant).
 */
export async function importTenantData(
  targetOrgId: string,
  data: TenantExport,
): Promise<ImportSummary> {
  if (data.version !== EXPORT_VERSION) {
    throw new Error(
      `unsupported export version ${data.version} (expected ${EXPORT_VERSION})`,
    );
  }

  // Pre-mint a new id for every row of every id-bearing table, so foreign keys
  // (including forward references resolved during a later table's insert) all
  // remap through a single, complete set of maps.
  const idMaps: Record<string, IdMap> = {};
  for (const step of INSERT_PLAN) {
    if (step.compositePk) continue;
    const map: IdMap = new Map();
    for (const row of rowsFor(data, step.name)) {
      map.set(String(row.id), randomUUID());
    }
    idMaps[step.name] = map;
  }

  return withOrg(targetOrgId, async (tx) => {
    // Emptiness guard — refuse to write into an org that already has content.
    for (const step of INSERT_PLAN) {
      const existing = await step.delegate(tx).count();
      if (existing > 0) {
        throw new Error(
          `target org ${targetOrgId} is not empty (found ${existing} rows in ${step.name})`,
        );
      }
    }

    const imported: Record<string, number> = {};
    for (const step of INSERT_PLAN) {
      const rows = rowsFor(data, step.name);
      if (rows.length === 0) {
        imported[step.name] = 0;
        continue;
      }
      const map = idMaps[step.name];
      const prepared = rows.map((row) => {
        const out: Row = { ...row, orgId: targetOrgId };
        if (!step.compositePk) out.id = remap(map, row.id, step.name);
        for (const { field, target } of step.fkRefs ?? []) {
          if (out[field] != null) {
            out[field] = remap(idMaps[target], out[field], target);
          }
        }
        for (const field of step.nullFields ?? []) out[field] = null;
        for (const field of step.selfRefs ?? []) out[field] = null;
        return out;
      });
      const { count } = await step.delegate(tx).createMany({ data: prepared });
      imported[step.name] = count;
    }

    // Second pass: restore the self-references we nulled on insert, now that
    // every row (and its new id) exists.
    for (const step of INSERT_PLAN) {
      if (!step.selfRefs) continue;
      const map = idMaps[step.name];
      for (const row of rowsFor(data, step.name)) {
        const patch: Record<string, unknown> = {};
        for (const field of step.selfRefs) {
          if (row[field] != null) patch[field] = remap(map, row[field], step.name);
        }
        if (Object.keys(patch).length > 0) {
          await step.delegate(tx).update({
            where: { id: remap(map, row.id, step.name) },
            data: patch,
          });
        }
      }
    }

    const total = Object.values(imported).reduce((sum, n) => sum + n, 0);
    return { targetOrgId, imported, total };
  });
}
