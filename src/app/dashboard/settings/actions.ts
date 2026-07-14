"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeMemberTiers } from "@/lib/member-tiers";

// Org settings mutations. organizations carries NO RLS (it's platform data, not
// tenant data — see @/lib/auth), so these write as the plain app_user
// connection, scoped explicitly by the context orgId. Configuration changes are
// admin-only: staff can read the settings surface but the write is gated on the
// Clerk-derived role, failing closed for anyone else.

// Persist the org's member-tier vocabulary. The editor submits one tier per
// line; we normalize (trim / drop blanks / de-dupe / cap) through the shared
// helper, then merge into the settings JSON so other keys are preserved.
export async function updateMemberTiers(formData: FormData): Promise<void> {
  const { orgId, role } = await requireOrgContext();
  if (role !== "admin")
    throw new Error("only an admin can change organization settings");

  const tiers = normalizeMemberTiers(
    String(formData.get("tiers") ?? "").split("\n"),
  );

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings =
    org?.settings != null && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>)
      : {};

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: { ...settings, memberTiers: tiers } },
  });

  revalidatePath("/dashboard/settings");
}
