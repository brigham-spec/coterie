"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";

import { requireOrgContext } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";
import { type MemberTier, normalizeMemberTierDefs } from "@/lib/member-tiers";
import {
  type MembershipPackage,
  normalizeMembershipPackages,
} from "@/lib/membership-packages";
import { normalizeModuleSelection } from "@/lib/modules";

// Org settings mutations. organizations carries NO RLS (it's platform data, not
// tenant data — see @/lib/auth), so these write as the plain app_user
// connection, scoped explicitly by the context orgId. Configuration changes are
// admin-only: staff can read the settings surface but the write is gated on the
// Clerk-derived role, failing closed for anyone else.

// Shallow-merge a patch into the org's settings JSON, preserving every other
// key. Every mutation below stores one section of settings, so this
// read-coerce-merge-write dance lives here once rather than being repeated.
async function patchOrgSettings(
  orgId: string,
  patch: Record<string, unknown>,
): Promise<void> {
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
    data: {
      settings: { ...settings, ...patch } as Prisma.InputJsonValue,
    },
  });
}

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

  await patchOrgSettings(orgId, { memberTiers: tiers });

  revalidatePath("/dashboard/settings");
  // The tier vocabulary also feeds the companies-list filter and every company
  // profile's membership-tier <select>; revalidate those consumers too, or a
  // newly added/removed tier stays stale on them until an unrelated cache bust.
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/companies/[id]", "page");
  return { status: "saved", tiers };
}

// useActionState result for the membership-packages editor. On success we echo
// the NORMALIZED packages back so the editor shows exactly what was stored
// (blank-name packages dropped, prices coerced, service bullets cleaned) rather
// than leaving the admin to spot the difference on reload.
export type UpdatePackagesState =
  | { status: "idle" }
  | { status: "saved"; packages: MembershipPackage[] }
  | { status: "error"; message: string };

// Persist the org's membership packages — the sellable offerings proposals and
// the (later) generators draw on. The editor submits parallel arrays paired by
// index: one name / price / summary per row, plus that row's services as a
// newline-delimited textarea. We zip and normalize through the shared helper,
// then merge into the settings JSON so other keys are preserved. Admin-only, and
// the gate fails closed before any query.
export async function updateMembershipPackages(
  _prev: UpdatePackagesState,
  formData: FormData,
): Promise<UpdatePackagesState> {
  const { orgId, role } = await requireOrgContext();
  if (role !== "admin")
    return {
      status: "error",
      message: "Only an admin can change organization settings.",
    };

  const names = formData.getAll("name").map(String);
  const prices = formData.getAll("price").map(String);
  const summaries = formData.getAll("summary").map(String);
  const services = formData.getAll("services").map(String);
  const packages = normalizeMembershipPackages(
    names.map((name, i) => {
      const raw = (prices[i] ?? "").trim();
      const num = raw === "" ? null : Number(raw);
      return {
        name,
        annualPrice: num !== null && Number.isFinite(num) ? num : null,
        summary: summaries[i] ?? "",
        includedServices: (services[i] ?? "").split(/\r?\n/),
      };
    }),
  );

  await patchOrgSettings(orgId, { membershipPackages: packages });

  revalidatePath("/dashboard/settings");
  return { status: "saved", packages };
}

// useActionState result for the "your name" form. On success we echo the stored
// (trimmed) name back so the editor reflects exactly what landed.
export type UpdateNameState =
  | { status: "idle" }
  | { status: "saved"; name: string }
  | { status: "error"; message: string };

// Longest recognized display name we store (defensive cap on free text).
const MAX_NAME_LENGTH = 80;

// Let the signed-in user set THEIR OWN recognized display name — the label shown
// as owner, actor, greeting, and in staff pickers throughout the tool. Seeded
// from Clerk on first sign-in (see provisionUser), then user-owned: provisioning
// no longer re-syncs `name`, so this edit sticks. Scoped to ctx.userId (you can
// only rename yourself), so no admin gate — anyone can set their own name.
export async function updateDisplayName(
  _prev: UpdateNameState,
  formData: FormData,
): Promise<UpdateNameState> {
  const { userId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  if (name === "")
    return { status: "error", message: "Your name can't be empty." };

  await prisma.user.update({ where: { id: userId }, data: { name } });

  // The name surfaces across the whole dashboard shell (greeting) plus owner and
  // actor labels, so bust the section layout to re-render every consumer.
  revalidatePath("/dashboard", "layout");
  return { status: "saved", name };
}

// useActionState result for the module toggle form.
export type SetModulesState =
  | { status: "idle" }
  | { status: "saved"; count: number }
  | { status: "error"; message: string };

// Persist which OPTIONAL modules this org sees. This is PLATFORM-OPERATOR only —
// product packaging is our decision, not the tenant admin's — so the gate is
// isPlatformAdmin (an env email allowlist), NOT the org's own admin role. The
// form submits the checked optional keys as "module"; we normalize (valid
// optional keys only, de-duped, canonical order) and merge into settings.modules,
// preserving other settings keys. Storing the explicit list flips the org off the
// "all-on" default, so unchecking every box genuinely hides every optional module.
export async function setOrgModules(
  _prev: SetModulesState,
  formData: FormData,
): Promise<SetModulesState> {
  const ctx = await requireOrgContext();
  if (!isPlatformAdmin(ctx))
    return {
      status: "error",
      message: "Only the platform operator can change modules.",
    };

  const modules = normalizeModuleSelection(formData.getAll("module").map(String));

  await patchOrgSettings(ctx.orgId, { modules });

  // The enabled set drives the whole dashboard shell (sidebar + command palette)
  // and every route guard, so bust the layout for the entire section.
  revalidatePath("/dashboard", "layout");
  return { status: "saved", count: modules.length };
}
