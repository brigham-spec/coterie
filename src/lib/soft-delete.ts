import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Soft-delete engine (archival trash table).
 *
 * A company/contact hard-delete cascades away an entangled subgraph (contacts,
 * invoices+payments, meetings, intros, notes, value, proposals, activities, …).
 * Row-hiding soft-delete would break RLS'd required relations (a hidden company
 * makes Contact.company resolve to null and Prisma throws). Instead we SNAPSHOT
 * the whole destroyed subgraph into `deleted_records` (one JSON envelope), then
 * hard-delete from the live tables. Recover re-inserts the snapshot verbatim —
 * ORIGINAL ids preserved — in FK-dependency order.
 *
 * Every function takes a tx and must run inside the caller's `withOrg` so RLS
 * scopes it to the tenant.
 */

export const SNAPSHOT_VERSION = 1;

export type DeletedKind = "company" | "contact";

export type Snapshot = {
  version: number;
  kind: DeletedKind;
  recordId: string;
  tables: Record<string, unknown[]>;
};

type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

// The table keys inside a snapshot envelope. Snapshot writes and restore reads
// both reference these unions, so a mistyped key is a compile error rather than
// a silently dropped table on recover (data loss in a recovery feature).
type CompanyTableKey =
  | "company"
  | "contacts"
  | "invoices"
  | "payments"
  | "introductions"
  | "valueDelivered"
  | "projectLinks"
  | "newsItems"
  | "activities"
  | "membershipProposals"
  | "affiliations"
  | "keyRelationships"
  | "notes"
  | "actionItems"
  | "meetingAttendees"
  | "introDismissals";

type ContactTableKey = "contact" | "introductions" | "actionItems" | "meetingAttendees";

/**
 * Normalize a raw Prisma read (Decimal → string, Date → ISO) into a plain JSON
 * value. Guarantees what we store equals what restore reads back, and yields a
 * type Prisma's Json input accepts.
 */
function toPlainJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rows(tables: Record<string, unknown[]>, key: string): Row[] {
  const v = tables[key];
  return Array.isArray(v) ? (v as Row[]) : [];
}

type CreateManyDelegate = {
  createMany: (args: { data: Row[] }) => Promise<{ count: number }>;
};

async function createManyIfAny(delegate: CreateManyDelegate, data: Row[]): Promise<void> {
  if (data.length > 0) await delegate.createMany({ data });
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

/**
 * Read every row a company hard-delete would destroy. SetNull relations
 * (owner, referredBy, developer links, emailMessages, eventConversions,
 * key-relationship links) survive the delete, so they are NOT snapshotted.
 * Reads are sequential — the withOrg tx pins one connection.
 */
async function snapshotCompany(
  tx: Tx,
  companyId: string,
): Promise<Record<string, unknown[]>> {
  const company = await tx.company.findUnique({ where: { id: companyId } });
  if (company == null) return { company: [] };

  const contacts = await tx.contact.findMany({ where: { companyId } });
  const invoices = await tx.invoice.findMany({ where: { companyId } });
  const payments = await tx.payment.findMany({ where: { invoice: { companyId } } });
  const introductions = await tx.introduction.findMany({
    where: { OR: [{ partyA: { companyId } }, { partyB: { companyId } }] },
  });
  const valueDelivered = await tx.valueDelivered.findMany({ where: { companyId } });
  const projectLinks = await tx.projectLink.findMany({ where: { companyId } });
  const newsItems = await tx.newsItem.findMany({ where: { companyId } });
  const activities = await tx.activity.findMany({ where: { companyId } });
  const membershipProposals = await tx.membershipProposal.findMany({ where: { companyId } });
  const affiliations = await tx.affiliation.findMany({ where: { companyId } });
  const keyRelationships = await tx.keyRelationship.findMany({ where: { companyId } });
  const notes = await tx.note.findMany({ where: { companyId } });
  const actionItems = await tx.actionItem.findMany({
    where: { OR: [{ companyId }, { ownerContact: { companyId } }] },
  });
  const meetingAttendees = await tx.meetingAttendee.findMany({
    where: { contact: { companyId } },
  });
  const introDismissals = await tx.introDismissal.findMany({
    where: { OR: [{ focusCompanyId: companyId }, { candidateCompanyId: companyId }] },
  });

  return {
    company: [company],
    contacts,
    invoices,
    payments,
    introductions,
    valueDelivered,
    projectLinks,
    newsItems,
    activities,
    membershipProposals,
    affiliations,
    keyRelationships,
    notes,
    actionItems,
    meetingAttendees,
    introDismissals,
  } satisfies Record<CompanyTableKey, unknown[]>;
}

/**
 * Read every row a single contact hard-delete would destroy or block on:
 * meetingAttendees cascade; introductions (party A/B) and owned action items
 * are RESTRICT children that must be pre-deleted, so they are snapshotted too.
 */
async function snapshotContact(
  tx: Tx,
  contactId: string,
): Promise<Record<string, unknown[]>> {
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (contact == null) return { contact: [] };

  const introductions = await tx.introduction.findMany({
    where: { OR: [{ partyAContactId: contactId }, { partyBContactId: contactId }] },
  });
  const actionItems = await tx.actionItem.findMany({ where: { ownerContactId: contactId } });
  const meetingAttendees = await tx.meetingAttendee.findMany({ where: { contactId } });

  return {
    contact: [contact],
    introductions,
    actionItems,
    meetingAttendees,
  } satisfies Record<ContactTableKey, unknown[]>;
}

// ─── Deletes ───────────────────────────────────────────────────────────────────

/**
 * Snapshot a company's full subgraph into deleted_records, then hard-delete it.
 * Returns false if the company isn't visible in this org (RLS). RESTRICT
 * children (party intros, contact-owned action items) are pre-deleted so the
 * company cascade can complete.
 */
export async function softDeleteCompany(
  tx: Tx,
  companyId: string,
  deletedByUserId: string | null,
): Promise<boolean> {
  const tables = await snapshotCompany(tx, companyId);
  const company = tables.company[0] as { id: string; name: string; orgId: string } | undefined;
  if (company == null) return false;

  await tx.deletedRecord.create({
    data: {
      orgId: company.orgId,
      kind: "company",
      recordId: companyId,
      label: company.name,
      snapshot: toPlainJson({
        version: SNAPSHOT_VERSION,
        kind: "company",
        recordId: companyId,
        tables,
      }),
      deletedByUserId,
    },
  });

  await tx.introduction.deleteMany({
    where: { OR: [{ partyA: { companyId } }, { partyB: { companyId } }] },
  });
  await tx.actionItem.deleteMany({ where: { ownerContact: { companyId } } });
  await tx.company.delete({ where: { id: companyId } });
  return true;
}

/**
 * Snapshot a single contact's subgraph into deleted_records, then hard-delete
 * it. Returns the contact's companyId (for caller revalidation) or null if the
 * contact isn't visible in this org. Party intros and owned action items are
 * RESTRICT children, pre-deleted here (the live removeContact never did this —
 * a latent bug this path fixes).
 */
export async function softDeleteContact(
  tx: Tx,
  contactId: string,
  deletedByUserId: string | null,
): Promise<string | null> {
  const tables = await snapshotContact(tx, contactId);
  const contact = tables.contact[0] as
    | { id: string; name: string; orgId: string; companyId: string }
    | undefined;
  if (contact == null) return null;

  await tx.deletedRecord.create({
    data: {
      orgId: contact.orgId,
      kind: "contact",
      recordId: contactId,
      label: contact.name,
      snapshot: toPlainJson({
        version: SNAPSHOT_VERSION,
        kind: "contact",
        recordId: contactId,
        tables,
      }),
      deletedByUserId,
    },
  });

  await tx.introduction.deleteMany({
    where: { OR: [{ partyAContactId: contactId }, { partyBContactId: contactId }] },
  });
  await tx.actionItem.deleteMany({ where: { ownerContactId: contactId } });
  await tx.contact.delete({ where: { id: contactId } });
  return contact.companyId;
}

// ─── Restores ──────────────────────────────────────────────────────────────────

/**
 * Re-insert a company subgraph verbatim, original ids preserved, in
 * FK-dependency order. Invoices carry a self-FK (parentInvoiceId) — inserted
 * null then repaired in a second pass once every invoice row exists.
 */
async function restoreCompany(tx: Tx, tables: Record<string, unknown[]>): Promise<void> {
  const get = (key: CompanyTableKey): Row[] => rows(tables, key);
  const invoices = get("invoices");

  await createManyIfAny(tx.company as unknown as CreateManyDelegate, get("company"));
  await createManyIfAny(tx.contact as unknown as CreateManyDelegate, get("contacts"));
  await createManyIfAny(
    tx.invoice as unknown as CreateManyDelegate,
    invoices.map((r) => ({ ...r, parentInvoiceId: null })),
  );
  await createManyIfAny(tx.payment as unknown as CreateManyDelegate, get("payments"));
  await createManyIfAny(
    tx.introduction as unknown as CreateManyDelegate,
    get("introductions"),
  );
  await createManyIfAny(
    tx.valueDelivered as unknown as CreateManyDelegate,
    get("valueDelivered"),
  );
  await createManyIfAny(
    tx.projectLink as unknown as CreateManyDelegate,
    get("projectLinks"),
  );
  await createManyIfAny(tx.newsItem as unknown as CreateManyDelegate, get("newsItems"));
  await createManyIfAny(tx.activity as unknown as CreateManyDelegate, get("activities"));
  await createManyIfAny(
    tx.membershipProposal as unknown as CreateManyDelegate,
    get("membershipProposals"),
  );
  await createManyIfAny(
    tx.affiliation as unknown as CreateManyDelegate,
    get("affiliations"),
  );
  await createManyIfAny(
    tx.keyRelationship as unknown as CreateManyDelegate,
    get("keyRelationships"),
  );
  await createManyIfAny(tx.note as unknown as CreateManyDelegate, get("notes"));
  await createManyIfAny(
    tx.actionItem as unknown as CreateManyDelegate,
    get("actionItems"),
  );
  await createManyIfAny(
    tx.meetingAttendee as unknown as CreateManyDelegate,
    get("meetingAttendees"),
  );
  await createManyIfAny(
    tx.introDismissal as unknown as CreateManyDelegate,
    get("introDismissals"),
  );

  for (const inv of invoices) {
    if (inv.parentInvoiceId != null) {
      await tx.invoice.update({
        where: { id: inv.id as string },
        data: { parentInvoiceId: inv.parentInvoiceId as string },
      });
    }
  }
}

/**
 * Re-insert a single contact subgraph verbatim, original ids preserved, in
 * FK-dependency order.
 */
async function restoreContact(tx: Tx, tables: Record<string, unknown[]>): Promise<void> {
  const get = (key: ContactTableKey): Row[] => rows(tables, key);

  await createManyIfAny(tx.contact as unknown as CreateManyDelegate, get("contact"));
  await createManyIfAny(
    tx.introduction as unknown as CreateManyDelegate,
    get("introductions"),
  );
  await createManyIfAny(
    tx.actionItem as unknown as CreateManyDelegate,
    get("actionItems"),
  );
  await createManyIfAny(
    tx.meetingAttendee as unknown as CreateManyDelegate,
    get("meetingAttendees"),
  );
}

/**
 * Recover a trashed record: replay its snapshot into the live tables, then drop
 * the deleted_records row. Returns false if the id isn't visible in this org.
 */
export async function restoreDeletedRecord(
  tx: Tx,
  deletedRecordId: string,
): Promise<boolean> {
  const record = await tx.deletedRecord.findUnique({ where: { id: deletedRecordId } });
  if (record == null) return false;

  const snapshot = record.snapshot as unknown as Snapshot;
  const tables = snapshot.tables ?? {};
  if (snapshot.kind === "company") {
    await restoreCompany(tx, tables);
  } else if (snapshot.kind === "contact") {
    await restoreContact(tx, tables);
  } else {
    throw new Error(`Unknown deleted-record kind: ${String(snapshot.kind)}`);
  }

  await tx.deletedRecord.delete({ where: { id: deletedRecordId } });
  return true;
}
