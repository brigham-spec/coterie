"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import { prisma } from "@/lib/prisma";
import { storeCredential, deleteCredential } from "@/lib/integrations";
import { inngest } from "@/lib/inngest";
import {
  generateActionItems,
  type ActionItemCandidate,
  type OwnerCandidate,
} from "@/lib/action-items";

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

export async function syncFirefliesNow(): Promise<void> {
  const { orgId } = await requireOrgContext();
  // Enqueue the durable sync job. org_id travels in the payload — the job has no
  // ambient tenant context (see @/lib/inngest).
  await inngest.send({ name: "coterie/fireflies.sync", data: { orgId } });
  revalidatePath("/dashboard/meetings");
  // The dashboard sync-status card reads the same integration row.
  revalidatePath("/dashboard");
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
// Extraction is human-in-the-loop: the AI proposes items + resolved owners, a
// human confirms/edits the owner and drops noise, then confirmed rows persist.
// The action_items owner-XOR CHECK (exactly one of user/contact, never null)
// means we never auto-commit a guessed owner (see @/lib/action-items).

// Org staff who can own a "we owe" item — the org's members. org_memberships is
// a platform table (no RLS), so it is read off the bare prisma client, exactly
// as @/lib/auth does.
async function loadStaffOwners(orgId: string): Promise<OwnerCandidate[]> {
  const rows = await prisma.orgMembership.findMany({
    where: { orgId },
    select: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.user.id, name: r.user.name }));
}

// This meeting's matched attendee contacts — the "they owe" owner candidates.
async function loadAttendeeOwners(
  orgId: string,
  meetingId: string,
): Promise<OwnerCandidate[]> {
  const rows = await withOrg(orgId, (tx) =>
    tx.meetingAttendee.findMany({
      where: { meetingId },
      select: { contactId: true, contact: { select: { name: true } } },
    }),
  );
  return rows.map((r) => ({ id: r.contactId, name: r.contact.name }));
}

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
// against the allowed set (org staff ids, or this meeting's attendee contact
// ids) — the client is never trusted — and mapped to exactly one owner column so
// the XOR CHECK holds.
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

  const [staff, attendees] = await Promise.all([
    loadStaffOwners(orgId),
    loadAttendeeOwners(orgId, meetingId),
  ]);
  const staffIds = new Set(staff.map((s) => s.id));
  const contactIds = new Set(attendees.map((c) => c.id));

  const toCreate: Array<{
    text: string;
    ownerUserId: string | null;
    ownerContactId: string | null;
  }> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const ownerKind = r.ownerKind;
    const ownerId = typeof r.ownerId === "string" ? r.ownerId : "";
    if (text === "") continue;
    if (ownerKind === "staff" && staffIds.has(ownerId))
      toCreate.push({ text, ownerUserId: ownerId, ownerContactId: null });
    else if (ownerKind === "contact" && contactIds.has(ownerId))
      toCreate.push({ text, ownerUserId: null, ownerContactId: ownerId });
    // Rows with an unresolved/foreign owner are rejected — the XOR CHECK needs
    // exactly one valid owner, so we drop them rather than guess.
  }
  if (toCreate.length === 0) return;

  await withOrg(orgId, async (tx) => {
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
  revalidatePath("/dashboard/meetings");
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
  revalidatePath("/dashboard/meetings");
}

export async function deleteActionItem(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") throw new Error("item required");

  await withOrg(orgId, (tx) =>
    tx.actionItem.deleteMany({ where: { id } }),
  );
  revalidatePath("/dashboard/meetings");
}
