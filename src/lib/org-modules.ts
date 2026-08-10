import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  enabledNavHrefs as computeEnabledNavHrefs,
  isModuleEnabled,
  type ModuleKey,
} from "@/lib/modules";

// Server-side bridge between the pure module registry (@/lib/modules) and the
// current tenant. The org's enablement lives in Organization.settings.modules;
// organizations carries no RLS (platform data), so this reads on the plain
// app_user connection scoped by the context orgId.
//
// The settings read is wrapped in React `cache`, so the layout's nav filter and
// every guarded page in the same request share ONE query.

const readOrgSettings = cache(async (): Promise<unknown> => {
  const { orgId } = await requireOrgContext();
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  return org?.settings ?? null;
});

/// Guard a route to the modules an org has enabled: if the module is off for this
/// tenant, render the not-found page (a disabled section is indistinguishable
/// from a missing one). Call at the top of each optional module's page.
export async function requireModule(key: ModuleKey): Promise<void> {
  const settings = await readOrgSettings();
  if (!isModuleEnabled(settings, key)) notFound();
}

/// The nav hrefs this tenant should see — fed to the sidebar and command palette
/// so hidden modules vanish from navigation as well as being route-guarded.
export async function enabledNavHrefs(): Promise<string[]> {
  return computeEnabledNavHrefs(await readOrgSettings());
}
