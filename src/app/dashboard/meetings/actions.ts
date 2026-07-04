"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { storeCredential, deleteCredential } from "@/lib/integrations";
import { inngest } from "@/lib/inngest";

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
