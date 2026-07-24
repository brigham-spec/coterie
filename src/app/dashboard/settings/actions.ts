"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type MemberTier, normalizeMemberTierDefs } from "@/lib/member-tiers";

// Org settings mutations. organizations carries NO RLS (it's platform data, not
// tenant data — see @/lib/auth), so these write as the plain app_user
// connection, scoped explicitly by the context orgId. Configuration changes are
// admin-only: staff can read the settings surface but the write is gated on the
// Clerk-derived role, failing closed for anyone else.

// useActionState result. On success we echo the NORMALIZED tier defs back so the
// editor can show the admin exactly what was stored (blanks/dupes dropped,
// labels/list capped, thresholds coerced) instead of leaving them to spot the
// difference on reload.
export type UpdateTiersState =
  | { status: "idle" }
  | { status: "saved"; tiers: MemberTier[] }
  | { status: "error"; message: string };

// Persist the org's member-tier vocabulary. The editor submits one label + one
// optional minimum-annual-value threshold per row (paired by index); we zip and
// normalize (trim / drop blanks / de-dupe / cap / coerce thresholds) through the
// shared helper, then merge into the settings JSON so other keys are preserved.
// The admin gate still fails closed — a non-admin write is refused before any
// query.
export async function updateMemberTiers(
  _prev: UpdateTiersState,
  formData: FormData,
): Promise<UpdateTiersState> {
  const { orgId, role } = await requireOrgContext();
  if (role !== "admin")
    return {
      status: "error",
      message: "Only an admin can change organization settings.",
    };

  const labels = formData.getAll("label").map(String);
  const mins = formData.getAll("minValue").map(String);
  const tiers = normalizeMemberTierDefs(
    labels.map((label, i) => {
      const raw = (mins[i] ?? "").trim();
      const num = raw === "" ? null : Number(raw);
      return {
        label,
        minValue: num !== null && Number.isFinite(num) ? num : null,
      };
    }),
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
  // The tier vocabulary also feeds the companies-list filter and every company
  // profile's membership-tier <select>; revalidate those consumers too, or a
  // newly added/removed tier stays stale on them until an unrelated cache bust.
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/companies/[id]", "page");
  return { status: "saved", tiers };
}
