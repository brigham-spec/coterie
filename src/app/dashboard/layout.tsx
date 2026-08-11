import type { ReactNode } from "react";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { NoActiveOrgError, requireOrgContext } from "@/lib/auth";
import { enabledNavHrefs } from "@/lib/org-modules";

import { Nav } from "./_nav";
import { CommandPalette } from "./_command-palette";

// The app shell: a fixed dark sidebar (tenant identity + grouped nav) beside a
// topbar and the scrolling content area. requireOrgContext is React-cached, so
// resolving the tenant here shares one provisioning pass with the page it wraps.
// A signed-in user without an active org can't be given the shell (no tenant to
// scope to) — we hand them the switcher so they can pick one they belong to.
//
// Tenants are OPERATOR-provisioned (scripts/create-org.mjs), never self-served:
// a client-created Clerk org would lazily provision a brand-new Postgres tenant
// (default orgType, all modules on), bypassing our packaging control. So the
// switcher is select-only — the "Create organization" affordance is hidden and
// personal accounts are suppressed. (The authoritative lock is the Clerk
// instance setting "Allow users to create organizations = off"; this hides the
// UI so the two stay in agreement.)
const switcherAppearance = {
  elements: {
    organizationSwitcherPopoverActionButton__createOrganization: {
      display: "none",
    },
  },
} as const;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (err instanceof NoActiveOrgError) return <NoActiveOrg />;
    throw err;
  }

  const navHrefs = await enabledNavHrefs();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-black/20 bg-ink px-3.5 py-5 text-white print:hidden">
        <div className="px-2.5">
          <div className="text-[9.5px] font-medium tracking-[0.18em] text-gold uppercase">
            Coterie
          </div>
          <div className="mt-1.5 font-serif text-[18px] leading-tight text-white">
            {ctx.orgName}
          </div>
        </div>
        <div className="mx-2.5 my-4 h-px bg-gradient-to-r from-gold/40 to-transparent" />
        <div className="-mr-1.5 flex-1 overflow-y-auto pr-1.5">
          <Nav enabledHrefs={navHrefs} />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col pl-60 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-8 backdrop-blur-md print:hidden">
          <CommandPalette enabledHrefs={navHrefs} />
          <div className="flex-1" />
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            appearance={switcherAppearance}
          />
          <UserButton />
        </header>
        <main className="flex-1 bg-canvas px-8 py-10 print:bg-surface print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function NoActiveOrg() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-[9.5px] font-medium tracking-[0.16em] text-gold uppercase">
        Coterie
      </div>
      <h1 className="mt-2 mb-2 font-serif text-2xl text-ink">
        Select an organization
      </h1>
      <p className="mb-6 text-sm text-ink-3">
        Choose an organization to view its network. Access is by invitation —
        if you don&rsquo;t see yours, contact your administrator.
      </p>
      <OrganizationSwitcher
        hidePersonal
        afterSelectOrganizationUrl="/dashboard"
        appearance={switcherAppearance}
      />
    </div>
  );
}
