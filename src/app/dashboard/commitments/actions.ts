"use server";

import Anthropic from "@anthropic-ai/sdk";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { optionalDate } from "@/lib/form-fields";
import { COMMITMENT_STATUSES } from "@/lib/commitments";
import { revalidateActionItemSurfaces } from "@/lib/revalidate";
import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  generateNudgeEmail,
  type NudgeEmailDraft,
} from "@/lib/nudge-email";

// Commitments surface actions. A commitment is an action_item; advancing it just
// moves its status. Bounded to the three valid states; RLS scopes the id to the
// org inside withOrg, so a foreign id matches no row (updateMany → 0 rows, no
// error). Mirrors meetings/updateActionItemStatus but revalidates this surface.

export async function updateCommitment(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (id === "") throw new Error("commitment required");
  if (!(COMMITMENT_STATUSES as string[]).includes(status))
    throw new Error("invalid status");

  // An optional completion note rides along only when resolving the item as done;
  // any other transition (reopen, dismiss) clears a stale note so a reopened item
  // never carries a resolution it no longer has.
  const note = String(formData.get("note") ?? "")
    .trim()
    .slice(0, 1000);
  const completionNote =
    status === "done" ? (note === "" ? null : note) : null;

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id }, data: { status, completionNote } }),
  );
  revalidateActionItemSurfaces();
}

// Batch-resolve the selected commitments in one write (parity: select mode +
// batch done/delete, Coterie.html:5726). The checked ids arrive as repeated
// "ids" fields; "done" advances their status, "delete" removes them outright
// (mirroring the single-row Done and the per-profile deleteCommitment). RLS
// scopes every id to the org, so a foreign id in the set matches no row.
export async function batchUpdateCommitments(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const ids = formData
    .getAll("ids")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const op = String(formData.get("op") ?? "").trim();
  if (ids.length === 0) throw new Error("no commitments selected");
  if (op !== "done" && op !== "delete")
    throw new Error("invalid batch operation");

  await withOrg(orgId, (tx) =>
    op === "delete"
      ? tx.actionItem.deleteMany({ where: { id: { in: ids } } })
      : tx.actionItem.updateMany({
          where: { id: { in: ids } },
          data: { status: "done" },
        }),
  );
  revalidateActionItemSurfaces();
}

// Inline text/due-date edit of an open commitment (parity: inline edit 13099).
export async function editCommitment(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const id = String(formData.get("id") ?? "").trim();
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 500);
  const dueDate = optionalDate(formData, "dueDate");
  if (id === "") throw new Error("commitment required");
  if (text === "") throw new Error("a commitment is required");

  await withOrg(orgId, (tx) =>
    tx.actionItem.updateMany({ where: { id }, data: { text, dueDate } }),
  );
  revalidateActionItemSurfaces();
}

// Log a manual commitment from the global page (parity: manual obligation 12623).
// Direction maps to the owner-XOR column: "we owe" → a staff owner (validated
// against org_memberships, which carry no RLS so we scope by org+user); "they
// owe" → a network contact (re-loaded withOrg so a foreign id resolves null).
// A they-owe item is anchored to the contact's company so it also surfaces on
// that company profile, mirroring the per-profile addCommitment.
export async function logCommitment(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();

  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 500);
  const direction = String(formData.get("direction") ?? "").trim();
  const ownerId = String(formData.get("ownerId") ?? "").trim();
  const dueDate = optionalDate(formData, "dueDate");

  if (text === "") throw new Error("a commitment is required");
  if (direction !== "we_owe" && direction !== "they_owe")
    throw new Error("invalid direction");
  if (ownerId === "") throw new Error("an owner is required");

  await withOrg(orgId, async (tx) => {
    let ownerUserId: string | null = null;
    let ownerContactId: string | null = null;
    let companyId: string | null = null;

    if (direction === "we_owe") {
      const member = await prisma.orgMembership.findUnique({
        where: { orgId_userId: { orgId, userId: ownerId } },
        select: { userId: true },
      });
      if (!member) throw new Error("owner is not a member of this organization");
      ownerUserId = ownerId;
    } else {
      const contact = await tx.contact.findUnique({
        where: { id: ownerId },
        select: { id: true, companyId: true },
      });
      if (!contact) throw new Error("contact not found in this organization");
      ownerContactId = contact.id;
      companyId = contact.companyId;
    }

    await tx.actionItem.create({
      data: {
        orgId,
        companyId,
        text,
        status: "open",
        dueDate,
        ownerUserId,
        ownerContactId,
      },
    });
  });

  revalidateActionItemSurfaces();
}

// Nudge-email draft (ported from the prototype, Coterie.html:6032). Drafts the
// short, warm follow-up the host sends to a network contact about an item they
// owe. The commitment is re-loaded withOrg-scoped from the id in the form (never
// trusting a client payload), so a foreign id resolves null → we never draft
// using another tenant's row. Only they-owe items have a contact to nudge; a
// we-owe item (staff owns it) has no recipient and is refused. The Anthropic call
// runs server-side in @/lib/nudge-email; the key never reaches the browser.
// Ephemeral — nothing is persisted.
//
// This is a useActionState action: it returns state rather than throwing, so
// model/network failures render inline instead of tripping the error boundary.

export type NudgeEmailState =
  | { status: "idle" }
  | { status: "ok"; draft: NudgeEmailDraft }
  | { status: "error"; message: string };

const DAY = 86_400_000;

// Whole-day overdue count from a @db.Date due date (UTC-midnight), read on the
// UTC calendar so the delta never skews a day in non-UTC zones. null when the
// item has no due date or is not yet past due.
function overdueDaysOf(dueDate: Date | null, now: Date): number | null {
  if (dueDate == null) return null;
  const startNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startDue = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const days = Math.round((startNow - startDue) / DAY);
  return days > 0 ? days : null;
}

export async function draftNudgeEmail(
  _prev: NudgeEmailState,
  formData: FormData,
): Promise<NudgeEmailState> {
  const id = String(formData.get("id") ?? "").trim();
  if (id === "") return { status: "error", message: "Select a commitment." };

  const { orgId, orgName, userName } = await requireOrgContext();

  const item = await withOrg(orgId, (tx) =>
    tx.actionItem.findUnique({
      where: { id },
      select: {
        text: true,
        dueDate: true,
        ownerContact: { select: { name: true, company: { select: { name: true } } } },
        meeting: { select: { title: true } },
      },
    }),
  );

  if (item == null)
    return { status: "error", message: "commitment not found in this organization" };
  if (item.ownerContact == null)
    return {
      status: "error",
      message: "Only items a contact owes can be nudged.",
    };

  try {
    await enforceAiRateLimit(orgId);
    const draft = await generateNudgeEmail({
      orgName,
      host: userName,
      contactName: item.ownerContact.name,
      companyName: item.ownerContact.company?.name ?? null,
      commitment: item.text,
      meetingTitle: item.meeting?.title ?? null,
      overdueDays: overdueDaysOf(item.dueDate, new Date()),
    });
    if (draft == null)
      return { status: "error", message: "Could not draft an email. Try again." };
    return { status: "ok", draft };
  } catch (err) {
    console.error("nudge email draft failed", err);
    if (err instanceof AiRateLimitError)
      return { status: "error", message: err.message };
    if (err instanceof Anthropic.AuthenticationError)
      return { status: "error", message: "AI is not configured. Check the API key." };
    if (err instanceof Anthropic.RateLimitError)
      return { status: "error", message: "AI is busy right now. Try again shortly." };
    return { status: "error", message: "Could not draft an email. Try again." };
  }
}
