"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/tenant";
import { isCompanyStatus } from "@/lib/company-statuses";
import { ACTIVITY_STATUS_CHANGED } from "@/lib/activity";
import { ORG_TAG_KEYS } from "@/lib/tags";
import {
  autoAssignTier,
  readMemberTierDefs,
  readMemberTiers,
} from "@/lib/member-tiers";

// Inline edits on the companies list revalidate the same three surfaces every
// company write touches: the row, the list, and the dashboard rollups.
function revalidateCompany(companyId: string): void {
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard");
}

// Create a company in the caller's tenant. org_id is stamped from the resolved
// context, never from client input — RLS's WITH CHECK backstops that on write.

export async function createCompany(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireOrgContext();

  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const annualValueRaw = String(formData.get("annualValue") ?? "").trim();

  if (!name || !status || !industry)
    throw new Error("name, status, and industry are required");
  // status is a closed vocabulary; reject anything the client shouldn't send.
  if (!isCompanyStatus(status)) throw new Error("invalid company status");

  const annualValue = annualValueRaw === "" ? "0" : annualValueRaw;
  if (Number.isNaN(Number(annualValue)) || Number(annualValue) < 0)
    throw new Error("annualValue must be a non-negative number");

  await withOrg(orgId, async (tx) => {
    const company = await tx.company.create({
      data: { orgId, name, status, industry, annualValue },
    });
    // Seed the status history with the founding status (from: null) so the
    // profile timeline has a lifecycle row from day one, mirroring the entry
    // changeCompanyStatus writes on every later transition.
    await tx.activity.create({
      data: {
        orgId,
        companyId: company.id,
        actorUserId: userId,
        type: ACTIVITY_STATUS_CHANGED,
        payload: { from: null, to: status },
        occurredAt: new Date(),
      },
    });
  });

  revalidatePath("/dashboard/companies");
}

// ── Inline quick-edit from the companies list ────────────────────────────────
// Focused single-field setters so each list cell (owner, tier, tags, value) can
// be edited in place without opening the profile. Each mirrors the validation
// the full-form updateCompany applies to that field, scopes the write to the
// tenant via withOrg (RLS makes a foreign row invisible → updateMany count 0),
// and revalidates the row + list + dashboard.

// Owner: blank clears it; a set value must be a member of THIS org. org_memberships
// carry no RLS, so scope the check explicitly by (org, user).
export async function setCompanyOwner(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const raw = String(formData.get("ownerUserId") ?? "").trim();
  const ownerUserId = raw === "" ? null : raw;
  if (ownerUserId !== null) {
    const membership = await prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: ownerUserId } },
      select: { userId: true },
    });
    if (membership == null)
      throw new Error("owner is not a member of this organization");
  }

  const ok = await withOrg(orgId, async (tx) => {
    const r = await tx.company.updateMany({
      where: { id: companyId },
      data: { ownerUserId },
    });
    return r.count > 0;
  });
  if (!ok) throw new Error("company not found in this organization");

  revalidateCompany(companyId);
}

// Tier: a manual inline pick locks the tier (tierLocked) so auto-assignment from
// annual value can't override the hand-set standing; the picked label must be
// configured for the org. Clearing it (blank) reverts to auto-assignment.
export async function setCompanyTier(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const tier = String(formData.get("tier") ?? "").trim();

  if (tier !== "") {
    const tierLabels = readMemberTiers(
      (
        await prisma.organization.findUnique({
          where: { id: orgId },
          select: { settings: true },
        })
      )?.settings,
    );
    if (!tierLabels.includes(tier))
      throw new Error("tier is not configured for this organization");
  }

  const ok = await withOrg(orgId, async (tx) => {
    const r = await tx.company.updateMany({
      where: { id: companyId },
      data:
        tier === ""
          ? { tier: null, tierLocked: false }
          : { tier, tierLocked: true },
    });
    return r.count > 0;
  });
  if (!ok) throw new Error("company not found in this organization");

  revalidateCompany(companyId);
}

// Tags: checkbox group → only known org-tag keys survive.
export async function setCompanyTags(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  const networkTags = formData
    .getAll("networkTags")
    .map((t) => String(t))
    .filter((t) => ORG_TAG_KEYS.has(t));

  const ok = await withOrg(orgId, async (tx) => {
    const r = await tx.company.updateMany({
      where: { id: companyId },
      data: { networkTags },
    });
    return r.count > 0;
  });
  if (!ok) throw new Error("company not found in this organization");

  revalidateCompany(companyId);
}

// Value: annualValue is a Decimal (blank → "0", must be non-negative). Mirrors
// updateCompany's tier coupling — when a member's tier isn't locked, re-derive
// it from the new value against the org's sliding thresholds, keeping the
// existing tier when nothing qualifies.
export async function setCompanyValue(formData: FormData): Promise<void> {
  const { orgId } = await requireOrgContext();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) throw new Error("missing company");

  // Inline free-typing invites "$1,000" / "1,000" — strip currency symbols,
  // thousands separators, and spaces before validating so a formatted paste
  // doesn't surface a NaN error.
  const annualValueRaw = String(formData.get("annualValue") ?? "")
    .replace(/[$,\s]/g, "")
    .trim();
  const annualValue = annualValueRaw === "" ? "0" : annualValueRaw;
  if (Number.isNaN(Number(annualValue)) || Number(annualValue) < 0)
    throw new Error("annualValue must be a non-negative number");

  const tierDefs = readMemberTierDefs(
    (
      await prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      })
    )?.settings,
  );

  const ok = await withOrg(orgId, async (tx) => {
    const current = await tx.company.findUnique({
      where: { id: companyId },
      select: { status: true, tier: true, tierLocked: true },
    });
    if (current == null) return false;

    const autoTierEligible = !current.tierLocked && current.status === "member";
    const tier = autoTierEligible
      ? (autoAssignTier(Number(annualValue), tierDefs) ?? current.tier)
      : current.tier;

    await tx.company.update({
      where: { id: companyId },
      data: { annualValue, tier },
    });
    return true;
  });
  if (!ok) throw new Error("company not found in this organization");

  revalidateCompany(companyId);
}
