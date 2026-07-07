import "server-only";

import { cache } from "react";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";

// The identity bridge: turn a signed-in Clerk session into our tenant context.
//
// Clerk owns platform identity (one human, one org spanning many tenants); our
// Postgres owns tenant data. `auth()` hands us Clerk ids (user_… / org_…);
// tenant queries need our uuids — specifically the Organization.id that feeds
// `app.org_id` via withOrg. This module resolves that mapping, provisioning the
// platform rows (users / organizations / org_memberships) just-in-time on first
// sight. (Webhook-driven sync is deliberately deferred to build-order item 6;
// until then, lazy provisioning keeps the two identity planes in step.)
//
// organizations / users / org_memberships carry NO RLS, so these writes are
// correct as the app_user connection — they are platform-level, not tenant data.

export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

export class NoActiveOrgError extends Error {
  constructor() {
    super("NO_ACTIVE_ORG");
    this.name = "NoActiveOrgError";
  }
}

export type OrgContext = {
  /// Our Organization.id (uuid) — the value fed to withOrg / app.org_id.
  orgId: string;
  /// The tenant's display name (for the app shell).
  orgName: string;
  /// Our User.id (uuid).
  userId: string;
  /// The signed-in user's display name (for greetings).
  userName: string;
  clerkOrgId: string;
  clerkUserId: string;
  /// admin | staff (our vocabulary, mapped from Clerk's org role).
  role: string;
};

/// Resolve the current request's tenant context, provisioning platform rows on
/// first sight. Throws UnauthenticatedError (no session) or NoActiveOrgError
/// (signed in but no active organization) so callers fail closed.
///
/// Wrapped in React `cache` so the layout and the page it wraps share a single
/// resolution (and one round of provisioning) per request.
export const requireOrgContext = cache(
  async (): Promise<OrgContext> => {
    const { userId: clerkUserId, orgId: clerkOrgId, orgRole } = await auth();
    if (!clerkUserId) throw new UnauthenticatedError();
    if (!clerkOrgId) throw new NoActiveOrgError();

    const [user, org] = await Promise.all([
      provisionUser(clerkUserId),
      provisionOrg(clerkOrgId),
    ]);

    const role = orgRole === "org:admin" ? "admin" : "staff";
    await prisma.orgMembership.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      create: { orgId: org.id, userId: user.id, role },
      update: { role },
    });

    return {
      orgId: org.id,
      orgName: org.name,
      userId: user.id,
      userName: user.name,
      clerkOrgId,
      clerkUserId,
      role,
    };
  },
);

async function provisionUser(clerkUserId: string) {
  const cu = await currentUser();
  const email = cu?.primaryEmailAddress?.emailAddress ?? "";
  const name =
    [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") ||
    cu?.username ||
    email;
  return prisma.user.upsert({
    where: { clerkId: clerkUserId },
    create: { clerkId: clerkUserId, email, name },
    update: { email, name },
  });
}

async function provisionOrg(clerkOrgId: string) {
  const existing = await prisma.organization.findUnique({
    where: { clerkId: clerkOrgId },
  });
  if (existing) return existing;

  // First sight of this tenant — pull its name from Clerk once, then persist.
  const client = await clerkClient();
  const clerkOrg = await client.organizations.getOrganization({
    organizationId: clerkOrgId,
  });
  const orgType =
    typeof clerkOrg.publicMetadata?.orgType === "string"
      ? clerkOrg.publicMetadata.orgType
      : "edc";
  return prisma.organization.create({
    data: { clerkId: clerkOrgId, name: clerkOrg.name, orgType },
  });
}
