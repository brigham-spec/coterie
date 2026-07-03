import type { ReactNode } from "react";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { NoActiveOrgError, requireOrgContext } from "@/lib/auth";

import { Nav } from "./_nav";

// The app shell: a fixed dark sidebar (tenant identity + grouped nav) beside a
// topbar and the scrolling content area. requireOrgContext is React-cached, so
// resolving the tenant here shares one provisioning pass with the page it wraps.
// A signed-in user without an active org can't be given the shell (no tenant to
// scope to) — we hand them the switcher instead so they can pick/create one.

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

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col bg-ink px-3 py-5 text-white">
        <div className="px-3">
          <div className="text-[9.5px] font-medium tracking-[0.16em] text-gold uppercase">
            Coterie
          </div>
          <div className="mt-1 font-serif text-[17px] leading-tight text-white">
            {ctx.orgName}
          </div>
        </div>
        <div className="mx-3 my-4 h-px bg-gold/30" />
        <Nav />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col pl-56">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-line bg-surface px-6">
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
          <UserButton />
        </header>
        <main className="flex-1 bg-canvas px-6 py-8">{children}</main>
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
        Create or choose an organization to view its network.
      </p>
      <OrganizationSwitcher
        afterCreateOrganizationUrl="/dashboard"
        afterSelectOrganizationUrl="/dashboard"
      />
    </div>
  );
}
