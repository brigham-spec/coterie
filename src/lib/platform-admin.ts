import "server-only";

import type { OrgContext } from "@/lib/auth";

// The platform operator — you, running the product across every tenant — not a
// tenant's own admin. Some controls (which modules a tenant sees) are packaging
// decisions the operator makes, and must NOT be exposed to customers even at the
// org-admin role. Operator identity is an env allowlist of emails (set in the
// deploy environment, never in tenant data), matched against the signed-in
// user's primary email.
//
// PLATFORM_ADMIN_EMAILS is a comma-separated list, e.g. "you@coterie.io".
// Unset → nobody is a platform operator (fail closed): the operator-only
// surfaces simply don't render and their write actions refuse.

function platformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== ""),
  );
}

/// Is the current context's signed-in user the platform operator? Compares their
/// primary email (case-insensitively) against the PLATFORM_ADMIN_EMAILS allowlist.
export function isPlatformAdmin(ctx: OrgContext): boolean {
  const email = ctx.userEmail.trim().toLowerCase();
  if (email === "") return false;
  return platformAdminEmails().has(email);
}
