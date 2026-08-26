import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withOrg } from "@/lib/tenant";

// Tenant data export. Produces one versioned JSON snapshot of an organization's
// own data — for backup, portability, and operator-side restore. Read-only: it
// runs entirely inside a single withOrg transaction, so RLS scopes every table
// to the org and a foreign row can never leak into the file.
//
// Deliberately EXCLUDED, and why:
//   - platform tables (organizations / users / org_memberships) — identity,
//     owned by Clerk, not tenant content;
//   - integration_credentials — encrypted OAuth secrets, never exported;
//   - ephemeral caches (ai_rate_limits, proactive_scan_caches) and transient
//     rows (unmatched_attendees) — regenerated, not records;
//   - UI-overlay state (agenda_item_states, intro_dismissals,
//     prospect_dismissals) — per-view preferences, not the network's data.

export const EXPORT_VERSION = 1;

type TableLoader = {
  name: string;
  load: (tx: Prisma.TransactionClient) => Promise<unknown[]>;
};

// Companies first, then their satellites — ordered only for human readability;
// export order carries no meaning (a restorer re-derives FK order itself).
const TABLES: readonly TableLoader[] = [
  { name: "companies", load: (tx) => tx.company.findMany() },
  { name: "contacts", load: (tx) => tx.contact.findMany() },
  { name: "projects", load: (tx) => tx.project.findMany() },
  { name: "projectLinks", load: (tx) => tx.projectLink.findMany() },
  { name: "fundingSources", load: (tx) => tx.fundingSource.findMany() },
  { name: "introductions", load: (tx) => tx.introduction.findMany() },
  { name: "meetings", load: (tx) => tx.meeting.findMany() },
  { name: "meetingAttendees", load: (tx) => tx.meetingAttendee.findMany() },
  { name: "actionItems", load: (tx) => tx.actionItem.findMany() },
  { name: "invoices", load: (tx) => tx.invoice.findMany() },
  { name: "payments", load: (tx) => tx.payment.findMany() },
  { name: "newsItems", load: (tx) => tx.newsItem.findMany() },
  { name: "emailMessages", load: (tx) => tx.emailMessage.findMany() },
  { name: "activities", load: (tx) => tx.activity.findMany() },
  { name: "events", load: (tx) => tx.event.findMany() },
  { name: "eventInvitees", load: (tx) => tx.eventInvitee.findMany() },
  { name: "eventConversions", load: (tx) => tx.eventConversion.findMany() },
  {
    name: "membershipProposals",
    load: (tx) => tx.membershipProposal.findMany(),
  },
  { name: "valueDelivered", load: (tx) => tx.valueDelivered.findMany() },
  { name: "notes", load: (tx) => tx.note.findMany() },
  { name: "affiliations", load: (tx) => tx.affiliation.findMany() },
  { name: "keyRelationships", load: (tx) => tx.keyRelationship.findMany() },
];

// The set of tables an export covers — exposed for tests (to lock the sensitive
// exclusions in place) and for the restore side.
export const EXPORT_TABLE_NAMES: readonly string[] = TABLES.map((t) => t.name);

export type TenantExport = {
  version: number;
  orgId: string;
  orgName: string;
  exportedAt: string;
  tables: Record<string, unknown[]>;
};

export async function exportTenantData(
  orgId: string,
  orgName: string,
): Promise<TenantExport> {
  const tables = await withOrg(orgId, async (tx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      out[table.name] = await table.load(tx);
    }
    return out;
  });

  return {
    version: EXPORT_VERSION,
    orgId,
    orgName,
    exportedAt: new Date().toISOString(),
    tables,
  };
}
