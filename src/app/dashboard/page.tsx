import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { NoActiveOrgError, requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";

import { createCompany } from "./actions";

// First tenant-scoped page (build item 4). Route is protected in proxy.ts, so an
// unauthenticated request never reaches here. A signed-in user with no active
// org gets the switcher to create/select one; otherwise we list that org's
// companies — read through withOrg so RLS scopes the query to this tenant.

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (err instanceof NoActiveOrgError) return <NoActiveOrg />;
    throw err;
  }

  const companies = await withOrg(ctx.orgId, (tx) =>
    tx.company.findMany({ orderBy: { name: "asc" } }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
          <UserButton />
        </div>
      </header>

      <form action={createCompany} className="mb-8 grid grid-cols-2 gap-3">
        <input
          name="name"
          placeholder="Company name"
          required
          className="col-span-2 rounded border px-3 py-2"
        />
        <input
          name="status"
          placeholder="Status (e.g. prospect, member)"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="industry"
          placeholder="Industry"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="annualValue"
          placeholder="Annual value (USD)"
          inputMode="decimal"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="col-span-2 rounded bg-black px-4 py-2 text-white"
        >
          Add company
        </button>
      </form>

      {companies.length === 0 ? (
        <p className="text-zinc-500">No companies yet. Add one above.</p>
      ) : (
        <ul className="divide-y rounded border">
          {companies.map((c) => (
            <li key={c.id} className="flex justify-between px-4 py-3">
              <span className="font-medium">{c.name}</span>
              <span className="text-sm text-zinc-500">
                {c.status} · {c.industry}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoActiveOrg() {
  return (
    <div className="mx-auto w-full max-w-md px-6 py-16 text-center">
      <h1 className="mb-2 text-xl font-semibold">Select an organization</h1>
      <p className="mb-6 text-zinc-500">
        Create or choose an organization to view its network.
      </p>
      <div className="flex justify-center">
        <OrganizationSwitcher
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
        />
      </div>
    </div>
  );
}
