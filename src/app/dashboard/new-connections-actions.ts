"use server";

import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { inferOrgName, inferPersonName } from "@/lib/new-connections";

// New Connections Detected — triage actions for the dashboard panel. Each detected
// stranger (an unmatched_attendees row captured by the Fireflies sync) can be:
//   • promoted to a NEW prospect company (+ primary contact),
//   • attached as a contact on an EXISTING company, or
//   • dismissed (durable — survives re-sync).
// Every action re-loads the target row INSIDE withOrg, so RLS refuses ids from
// another tenant (findUnique returns null → we bail). Company references are
// re-verified in the same tx (a plain FK from the form would otherwise bypass
// RLS). Actions return state rather than throwing so the panel renders failures
// inline; they are called from a transition, not a form action.

export type ConnectionActionResult =
  | { status: "promoted"; companyId: string }
  | { status: "attached"; companyId: string }
  | { status: "dismissed" }
  | { status: "error"; message: string };

function contactNameOf(row: {
  inferredName: string | null;
  email: string;
}): string {
  return (row.inferredName ?? "").trim() || inferPersonName(row.email) || row.email;
}

function detectionNote(lastMeetingTitle: string | null): string {
  return lastMeetingTitle
    ? `Detected in meetings via Fireflies: ${lastMeetingTitle}`
    : "Detected in meetings via Fireflies";
}

// Promote a detected stranger to a prospect. If a company with the inferred name
// already exists we attach the person there instead of creating a duplicate.
export async function promoteConnection(
  id: string,
): Promise<ConnectionActionResult> {
  const { orgId } = await requireOrgContext();
  if (!id) return { status: "error", message: "Missing connection." };

  try {
    return await withOrg(orgId, async (tx) => {
      const row = await tx.unmatchedAttendee.findUnique({ where: { id } });
      if (row == null) return { status: "error" as const, message: "Not found." };

      const orgName =
        (row.inferredOrg ?? "").trim() || inferOrgName(row.domain) || row.domain;
      const contactName = contactNameOf(row);
      const note = detectionNote(row.lastMeetingTitle);

      const existing = await tx.company.findFirst({
        where: { name: { equals: orgName, mode: "insensitive" } },
        select: { id: true },
      });

      if (existing) {
        await attachContact(tx, orgId, existing.id, contactName, row.email, note);
        await tx.unmatchedAttendee.delete({ where: { id } });
        return { status: "attached" as const, companyId: existing.id };
      }

      const company = await tx.company.create({
        data: {
          orgId,
          name: orgName,
          status: "prospect",
          industry: "Other",
          annualValue: "0",
          emailDomain: row.domain,
          source: "Fireflies",
          notes: note,
          contacts: {
            create: {
              orgId,
              name: contactName,
              email: row.email,
              isPrimary: true,
              notes: note,
            },
          },
        },
        select: { id: true },
      });

      await tx.unmatchedAttendee.delete({ where: { id } });
      return { status: "promoted" as const, companyId: company.id };
    });
  } catch (err) {
    console.error("promote connection failed", err);
    return { status: "error", message: "Could not add this prospect." };
  } finally {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/companies");
  }
}

// Attach a detected stranger as a contact on an existing company (chosen by the
// operator). The company is re-verified inside withOrg so a foreign id is refused.
export async function attachConnection(
  id: string,
  companyId: string,
): Promise<ConnectionActionResult> {
  const { orgId } = await requireOrgContext();
  if (!id || !companyId)
    return { status: "error", message: "Missing connection or company." };

  try {
    return await withOrg(orgId, async (tx) => {
      const row = await tx.unmatchedAttendee.findUnique({ where: { id } });
      if (row == null) return { status: "error" as const, message: "Not found." };

      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      });
      if (company == null)
        return { status: "error" as const, message: "Company not found." };

      await attachContact(
        tx,
        orgId,
        company.id,
        contactNameOf(row),
        row.email,
        detectionNote(row.lastMeetingTitle),
      );
      await tx.unmatchedAttendee.delete({ where: { id } });
      return { status: "attached" as const, companyId: company.id };
    });
  } catch (err) {
    console.error("attach connection failed", err);
    return { status: "error", message: "Could not attach this contact." };
  } finally {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/companies");
  }
}

// Wave off a single detected stranger. Durable: the row stays with dismissedAt set
// (a re-sync bumps its count but the panel filters dismissed rows), so it never
// resurfaces.
export async function dismissConnection(
  id: string,
): Promise<ConnectionActionResult> {
  const { orgId } = await requireOrgContext();
  if (!id) return { status: "error", message: "Missing connection." };

  try {
    return await withOrg(orgId, async (tx) => {
      const row = await tx.unmatchedAttendee.findUnique({
        where: { id },
        select: { id: true },
      });
      if (row == null) return { status: "error" as const, message: "Not found." };
      await tx.unmatchedAttendee.update({
        where: { id },
        data: { dismissedAt: new Date() },
      });
      return { status: "dismissed" as const };
    });
  } catch (err) {
    console.error("dismiss connection failed", err);
    return { status: "error", message: "Could not dismiss." };
  } finally {
    revalidatePath("/dashboard");
  }
}

// Wave off everyone currently detected at one domain (the prototype's "Dismiss
// org"). Applies to the rows present now — a genuinely new person at that domain
// later is surfaced again rather than silently suppressed.
export async function dismissConnectionDomain(
  domain: string,
): Promise<ConnectionActionResult> {
  const { orgId } = await requireOrgContext();
  if (!domain) return { status: "error", message: "Missing domain." };

  try {
    await withOrg(orgId, (tx) =>
      tx.unmatchedAttendee.updateMany({
        where: { domain, dismissedAt: null },
        data: { dismissedAt: new Date() },
      }),
    );
    return { status: "dismissed" };
  } catch (err) {
    console.error("dismiss connection domain failed", err);
    return { status: "error", message: "Could not dismiss." };
  } finally {
    revalidatePath("/dashboard");
  }
}

// Shared: add a contact to a company, skipping the create if one with the same
// email already sits at that company (avoids duplicates on re-triage).
async function attachContact(
  tx: Prisma.TransactionClient,
  orgId: string,
  companyId: string,
  name: string,
  email: string,
  note: string,
): Promise<void> {
  const dupe = await tx.contact.findFirst({
    where: { companyId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (dupe) return;
  await tx.contact.create({
    data: { orgId, companyId, name, email, notes: note },
  });
}
