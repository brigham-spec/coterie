"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { optionalDate } from "@/lib/form-fields";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { revalidateActionItemSurfaces } from "@/lib/revalidate";
import { prisma } from "@/lib/prisma";
import {
  storeCredential,
  deleteCredential,
  getCredential,
} from "@/lib/integrations";
import { listTranscripts, FirefliesError } from "@/lib/fireflies";
import { firefliesSyncErrorMessage } from "@/lib/sync-status";
import { inngest } from "@/lib/inngest";
import {
  generateActionItems,
  ownerColumns,
  type ActionItemCandidate,
} from "@/lib/action-items";
import { loadStaffOwners, loadAttendeeOwners } from "@/lib/action-item-owners";

// Meetings surface actions (build item 6 slice 5). Connecting Fireflies stores
// the per-org API key encrypted (see @/lib/integrations + @/lib/crypto); the key
// is never read back to the browser. Syncing enqueues the background job, which
// scopes all writes withOrg. Confirm/reject act on the attendee matches the sync
// proposed — a human closes the loop on anything below the auto-confirm bar.

export async function connectFireflies(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (apiKey === "") throw new Error("a Fireflies API key is required");

  await storeCredential(orgId, "fireflies", { accessToken: apiKey });
  revalidatePath("/dashboard/meetings");
}

export async function disconnectFireflies(): Promise<void> {
  const { orgId } = await requireOrgContext();
  await deleteCredential(orgId, "fireflies");
  revalidatePath("/dashboard/meetings");
}

// A point-in-time snapshot of the two signals the "Sync now" client polls:
// when the durable job last stamped completion (lastSyncedAt) and how many
// Fireflies-sourced meetings exist. The client captures this before enqueuing,
// then polls readFirefliesSyncProgress until lastSyncedMs advances past the
// baseline — at which point the meeting delta is the "N new meetings" count.
export interface FirefliesSyncProgress {
  lastSyncedMs: number | null;
  firefliesMeetingCount: number;
}

// One withOrg read shared by the start action's baseline and every poll. Synced
// meetings are exactly those carrying a firefliesId (manual logs leave it null).
// The two reads run SEQUENTIALLY, not Promise.all: withOrg opens a Prisma
// interactive transaction whose RLS org_id is pinned via set_config on one
// connection, and concurrent queries on that shared tx are unsafe (same rule the
// sequential tenant-export loop follows).
async function readSyncSnapshot(orgId: string): Promise<FirefliesSyncProgress> {
  return withOrg(orgId, async (tx) => {
    const credential = await tx.integrationCredential.findFirst({
      where: { provider: "fireflies" },
      select: { lastSyncedAt: true },
    });
    const firefliesMeetingCount = await tx.meeting.count({
      where: { firefliesId: { not: null } },
    });
    return {
      lastSyncedMs: credential?.lastSyncedAt?.getTime() ?? null,
      firefliesMeetingCount,
    };
  });
}

export type SyncNowState =
  | { status: "started"; transcriptCount: number; sinceMs: number | null; baselineMeetingCount: number }
  | { status: "error"; message: string };

// "Sync now" used to enqueue the durable job and return void — the user got no
// signal, and any failure (bad key, Fireflies down) surfaced only silently in the
// background job. Now we do a lightweight synchronous PREFLIGHT: fetch the
// transcript list with the stored key. That both validates the credential (so a
// bad key produces a specific, actionable error right here) and reports how many
// transcripts are waiting, before handing the heavy reconcile off to the durable
// Inngest job. We also capture a baseline snapshot (last-sync clock + current
// meeting count) so the client can POLL until the background job advances the
// clock and then report the true "N new meetings" delta — real completion
// feedback, not a fire-and-forget "started". No revalidatePath here: the durable
// job hasn't written yet, so the client drives the refresh once it completes.
export async function syncFirefliesNow(): Promise<SyncNowState> {
  const { orgId } = await requireOrgContext();

  const credential = await getCredential(orgId, "fireflies");
  if (credential == null)
    return { status: "error", message: "Connect Fireflies before syncing." };

  let transcriptCount: number;
  try {
    const transcripts = await listTranscripts(credential.accessToken);
    transcriptCount = transcripts.length;
  } catch (err) {
    if (err instanceof FirefliesError)
      return {
        status: "error",
        message: firefliesSyncErrorMessage(err.status, err.message),
      };
    return {
      status: "error",
      message: "Couldn't reach Fireflies. Please try again.",
    };
  }

  // Baseline BEFORE enqueuing so a completion the poll observes is provably ours.
  const baseline = await readSyncSnapshot(orgId);

  // Enqueue the durable sync job. org_id travels in the payload — the job has no
  // ambient tenant context (see @/lib/inngest).
  await inngest.send({ name: "coterie/fireflies.sync", data: { orgId } });
  return {
    status: "started",
    transcriptCount,
    sinceMs: baseline.lastSyncedMs,
    baselineMeetingCount: baseline.firefliesMeetingCount,
  };
}

// Poll target for the "Sync now" client — reads the same snapshot the start
// action baselined. When lastSyncedMs advances past the captured sinceMs the
// durable job has finished; the meeting-count delta is the newly imported count.
export async function readFirefliesSyncProgress(): Promise<FirefliesSyncProgress> {
  const { orgId } = await requireOrgContext();
  return readSyncSnapshot(orgId);
}

export type LogMeetingState =
  | { status: "saved" }
  | { status: "error"; message: string };

// Global "+ Log Meeting" (Meet audit item 7). The sibling of the company-profile
// logMeeting, but network-wide: attendees can be ANY contact in the org, not just
// one company's, so this is the place to record a meeting that spans members.
// Manual meetings carry no firefliesId (so deleteMeeting's synced-guard leaves
// them removable) and confirmed "manual" attendee rows. RLS confines every lookup
// and write to this tenant.
export async function logManualMeeting(
  formData: FormData,
): Promise<LogMeetingState> {
  const { orgId } = await requireOrgContext();

  const title = String(formData.get("title") ?? "")
    .trim()
    .slice(0, 300);
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const heldAt = optionalDate(formData, "heldAt") ?? new Date();
  // Duration (minutes) is optional; a blank or non-positive value stays null
  // rather than persisting garbage. Cap at a day's worth. Mirrors logMeeting.
  const durationRaw = Number.parseInt(
    String(formData.get("durationMinutes") ?? "").trim(),
    10,
  );
  const durationMinutes =
    Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.min(durationRaw, 1440)
      : null;
  const attendeeIds = formData
    .getAll("attendeeIds")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!title) return { status: "error", message: "A meeting title is required." };
  if (attendeeIds.length === 0)
    return { status: "error", message: "Select at least one attendee." };

  const error = await withOrg(orgId, async (tx) => {
    // Any org contact may attend (unlike the profile log, which is scoped to one
    // company). RLS confines the lookup to this tenant; an id that isn't a contact
    // here is refused rather than silently dropped.
    const contacts = await tx.contact.findMany({
      where: { id: { in: attendeeIds } },
      select: { id: true },
    });
    if (contacts.length !== new Set(attendeeIds).size)
      return "An attendee is not a contact in this network.";

    await tx.meeting.create({
      data: {
        orgId,
        title,
        heldAt,
        summary,
        durationMinutes,
        location,
        attendees: {
          // orgId is inherited from the parent meeting's composite relation.
          create: contacts.map((c) => ({
            contactId: c.id,
            matchMethod: "manual",
            confidence: 1,
            confirmed: true,
          })),
        },
      },
    });
    return null;
  });

  if (error) return { status: "error", message: error };

  revalidatePath("/dashboard/meetings");
  return { status: "saved" };
}

// Human-verify a proposed attendee match. Both ids are scoped by RLS inside the
// withOrg tx, so a foreign meeting/contact simply matches no row.
export async function confirmAttendee(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const meetingId = String(formData.get("meetingId") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();
  if (!meetingId || !contactId) throw new Error("meeting and contact required");

  await withOrg(orgId, (tx) =>
    tx.meetingAttendee.updateMany({
      where: { meetingId, contactId },
      data: { confirmed: true },
    }),
  );
  revalidatePath("/dashboard/meetings");
}

// Reject a wrong match — remove the attendee row entirely. A later sync will not
// recreate it unless Fireflies still lists the attendee AND the matcher resolves
// them again, at which point it returns as unconfirmed for review.
export async function rejectAttendee(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const meetingId = String(formData.get("meetingId") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();
  if (!meetingId || !contactId) throw new Error("meeting and contact required");

  await withOrg(orgId, (tx) =>
    tx.meetingAttendee.deleteMany({ where: { meetingId, contactId } }),
  );
  revalidatePath("/dashboard/meetings");
}

// ── Action items (gap-audit cluster A) ─────────────────────────────────────
// Manual extraction is human-in-the-loop: the AI proposes items + resolved
// owners, a human confirms/edits the owner and drops noise, then confirmed rows
// persist. The action_items owner-XOR CHECK (exactly one of user/contact, never
// null) means we never auto-commit a guessed owner (see @/lib/action-items). The
// owner-candidate loaders live in @/lib/action-item-owners (shared with the
// automatic on-sync extraction).

export type ExtractState =
  | { status: "idle" }
  | { status: "ok"; candidates: ActionItemCandidate[] }
  | { status: "error"; message: string };

// Propose action items for one meeting from its notes. Returns candidates for
// human review — persists NOTHING. RLS scopes the meeting to the org; a foreign
// meetingId simply resolves to no summary.
export async function extractActionItems(
  _prev: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  const { orgId } = await requireOrgContext();

  const meetingId = String(formData.get("meetingId") ?? "").trim();
  if (meetingId === "") return { status: "error", message: "meeting required" };

  const meeting = await withOrg(orgId, (tx) =>
    tx.meeting.findUnique({
      where: { id: meetingId },
      select: { summary: true },
    }),
  );
  const summary = meeting?.summary?.trim() ?? "";
  // Mirror the prototype's guard: too little text to extract anything useful.
  if (summary.length < 20)
    return {
      status: "error",
      message: "This meeting has no notes to extract from.",
    };

  const [staff, contacts] = await Promise.all([
    loadStaffOwners(orgId),
    loadAttendeeOwners(orgId, meetingId),
  ]);

  try {
    await enforceAiRateLimit(orgId);
    const candidates = await generateActionItems(summary, staff, contacts);
    return { status: "ok", candidates };
  } catch (err) {
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    return {
      status: "error",
      message: "Extraction failed — please try again.",
    };
  }
}

// Persist the human-confirmed items. Every owner is re-validated server-side
// against the allowed set (org staff ids, or ANY network contact id) — the
// client is never trusted — and mapped to exactly one owner column so the XOR
// CHECK holds. Contacts are validated against the whole network, not just this
// meeting's attendees: that is the cross-attribution (Meet 12) — an item can be
// attributed to a member merely mentioned in the notes, and it then surfaces on
// their company profile as a "they owe" deliverable.
export async function saveActionItems(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const meetingId = String(formData.get("meetingId") ?? "").trim();
  if (meetingId === "") throw new Error("meeting required");

  let rows: unknown;
  try {
    rows = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    throw new Error("malformed action items");
  }
  if (!Array.isArray(rows)) throw new Error("malformed action items");

  const staff = await loadStaffOwners(orgId);
  const staffIds = new Set(staff.map((s) => s.id));

  // The contacts we need to validate are only those the client actually
  // attributed items to — gather them up front so the pool query is bounded by
  // the items being saved, not the size of the whole network.
  const candidateContactIds = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (r.ownerKind === "contact" && typeof r.ownerId === "string")
      candidateContactIds.add(r.ownerId);
  }

  await withOrg(orgId, async (tx) => {
    // Confirm each attributed contact is in the network (RLS scopes this to the
    // org). Any network contact is allowed, not just the meeting's attendees —
    // that widening is the cross-attribution seam: a mentioned but absent member
    // can own the item.
    const contactRows =
      candidateContactIds.size > 0
        ? await tx.contact.findMany({
            where: { id: { in: [...candidateContactIds] } },
            select: { id: true },
          })
        : [];
    const contactIds = new Set(contactRows.map((c) => c.id));

    const toCreate: Array<{
      text: string;
      ownerUserId: string | null;
      ownerContactId: string | null;
    }> = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const text = typeof r.text === "string" ? r.text.trim() : "";
      const ownerKind = typeof r.ownerKind === "string" ? r.ownerKind : "";
      const ownerId = typeof r.ownerId === "string" ? r.ownerId : "";
      if (text === "") continue;
      if (ownerKind === "staff" && staffIds.has(ownerId))
        toCreate.push({ text, ...ownerColumns("staff", ownerId) });
      else if (ownerKind === "contact" && contactIds.has(ownerId))
        toCreate.push({ text, ...ownerColumns("contact", ownerId) });
      // Rows with an unresolved/foreign owner are rejected — the XOR CHECK needs
      // exactly one valid owner, so we drop them rather than guess.
    }
    if (toCreate.length === 0) return;

    // Re-verify the meeting belongs to THIS org before linking rows to it.
    // action_items.meeting_id is a single-column FK to meetings(id) — RLS
    // WITH CHECK only guards our own org_id, so without this a crafted request
    // could attach an own-org item to another org's meeting id (an orphan that
    // straddles tenants). A foreign id resolves to no row, so we refuse. This
    // mirrors the parent-reload guard every other FK-write uses.
    const meeting = await tx.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true },
    });
    if (meeting === null)
      throw new Error("meeting not found in this organization");
    await tx.actionItem.createMany({
      data: toCreate.map((c) => ({ orgId, meetingId, ...c })),
    });
  });
  revalidateActionItemSurfaces();
}

// Advance an item's lifecycle. Bounded to the three valid states; RLS scopes the
// id to the org so a foreign id matches no row.
export async function updateActionItemStatus(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (id === "") throw new Error("item required");
  if (!["open", "done", "dropped"].includes(status))
    throw new Error("invalid status");

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id }, data: { status } }),
  );
  revalidateActionItemSurfaces();
}

export async function deleteActionItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("item required");

  await withOrg(orgId, (tx) =>
    tx.actionItem.deleteMany({ where: { id } }),
  );
  revalidateActionItemSurfaces();
}

// Manually correct a persisted item — the AI extraction can mis-word an item or
// mis-attribute its owner, so a human fixes both after the fact. The reassigned
// owner is re-validated exactly like saveActionItems (staff via org_memberships,
// contact via the RLS-scoped network) to keep the owner-XOR CHECK satisfied. RLS
// scopes the id to the org so a foreign id matches no row.
export async function editActionItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 500);
  const ownerKind = String(formData.get("ownerKind") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();
  if (id === "") throw new Error("item required");
  if (text === "") throw new Error("an action item is required");
  if (ownerKind !== "staff" && ownerKind !== "contact")
    throw new Error("invalid owner");
  if (ownerId === "") throw new Error("an owner is required");

  // Staff owners are org members (org_memberships carries no RLS, so scope it
  // explicitly by org + user — refuses a foreign-tenant user).
  if (ownerKind === "staff") {
    const member = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: ownerId } },
      select: { userId: true },
    });
    if (!member) throw new Error("owner is not a member of this organization");
  }

  await withOrg(orgId, async (tx) => {
    if (ownerKind === "contact") {
      // Any network contact may own the item (cross-attribution); RLS scopes the
      // lookup so a foreign id resolves to null.
      const contact = await tx.contact.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!contact) throw new Error("contact not found in this organization");
    }
    await tx.actionItem.updateMany({
      where: { id },
      data: { text, ...ownerColumns(ownerKind, ownerId) },
    });
  });
  revalidateActionItemSurfaces();
}
