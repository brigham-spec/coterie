import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";
import { readMemberTierDefs } from "@/lib/member-tiers";
import { readMembershipPackages } from "@/lib/membership-packages";
import { enabledModuleKeys } from "@/lib/modules";
import { Button, Card, CardHeader, PageTitle } from "@/components/ui";

import { NameForm } from "./_name-form";
import { TiersForm } from "./_tiers-form";
import { PackagesForm } from "./_packages-form";
import { ModulesForm } from "./_modules-form";
import { RestoreForm } from "./_restore-form";

// Organization settings. The first surface here is the member-tier vocabulary —
// each org's own labels for the standing it grants members (HVEDC: Chairman /
// Director / Advisory). Stored in Organization.settings JSON (no table); the
// editor writes one tier per line. organizations carries no RLS, so the read is
// a plain query scoped by the context orgId. Editing is admin-only; staff see
// the configured tiers read-only.

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { settings: true },
  });
  const tiers = readMemberTierDefs(org?.settings);
  const packages = readMembershipPackages(org?.settings);
  const isAdmin = ctx.role === "admin";
  const isOperator = isPlatformAdmin(ctx);
  const enabledModules = [...enabledModuleKeys(org?.settings)];
  // The operator restore picks a target org across the whole platform, so the
  // org list is fetched only for the operator (organizations carries no RLS).
  const orgs = isOperator
    ? await prisma.organization.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const valueFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <PageTitle
          title="Settings"
          subtitle={`Organization configuration for ${ctx.orgName}`}
        />
      </div>

      <Card className="mb-6">
        <CardHeader title="Your name" />
        <div className="p-4">
          <p className="mb-4 text-xs text-ink-2">
            Set the name others recognize you by in this tool. It&rsquo;s seeded
            from your login and yours to change.
          </p>
          <NameForm currentName={ctx.userName} email={ctx.userEmail} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Member tiers" />
        <div className="p-4">
          <p className="mb-4 text-xs text-ink-2">
            The tiers your organization uses to mark a member&rsquo;s standing.
            These appear as the Tier dropdown on each company. One per line, in
            display order.
          </p>

          {isAdmin ? (
            <TiersForm tiers={tiers} />
          ) : tiers.length === 0 ? (
            <p className="text-xs text-ink-3">
              No member tiers configured. An admin can set them here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tiers.map((t) => (
                <li
                  key={t.label}
                  className="flex items-center justify-between gap-3 text-xs text-ink"
                >
                  <span>{t.label}</span>
                  <span className="text-ink-3">
                    {t.minValue === null
                      ? "unranked"
                      : `≥ ${valueFmt.format(t.minValue)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Membership packages" />
        <div className="p-4">
          <p className="mb-4 text-xs text-ink-2">
            The offerings your organization proposes to members and prospects —
            name, annual price, and the services each includes. These feed
            membership proposals and prospect value props. Distinct from Member
            tiers above (a member&rsquo;s standing); packages are what you sell.
          </p>

          {isAdmin ? (
            <PackagesForm packages={packages} />
          ) : packages.length === 0 ? (
            <p className="text-xs text-ink-3">
              No membership packages configured. An admin can set them here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {packages.map((p) => (
                <li
                  key={p.name}
                  className="rounded border border-line p-3 text-xs text-ink"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-ink-3">
                      {p.annualPrice === null
                        ? "custom"
                        : `${valueFmt.format(p.annualPrice)}/yr`}
                    </span>
                  </div>
                  {p.summary !== "" && (
                    <p className="mt-1 text-ink-2">{p.summary}</p>
                  )}
                  {p.includedServices.length > 0 && (
                    <ul className="mt-2 list-disc pl-4 text-ink-2">
                      {p.includedServices.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader
            title="Bulk import"
            action={
              <Link href="/dashboard/companies/import">
                <Button>Open importer</Button>
              </Link>
            }
          />
          <div className="p-4">
            <p className="text-xs text-ink-2">
              Add many companies and contacts at once from a CSV — one row per
              contact, with their company&rsquo;s columns alongside. Existing
              records are left untouched, so re-importing is safe. Admin only.
            </p>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader
            title="Activity log"
            action={
              <Link href="/dashboard/settings/activity">
                <Button>View log</Button>
              </Link>
            }
          />
          <div className="p-4">
            <p className="text-xs text-ink-2">
              An org-wide record of lifecycle activity — who changed which
              company&rsquo;s status, and when — newest first. Admin only.
            </p>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader
            title="Data export"
            action={
              <a href="/dashboard/settings/export">
                <Button>Download JSON</Button>
              </a>
            }
          />
          <div className="p-4">
            <p className="text-xs text-ink-2">
              A full snapshot of your organization&rsquo;s data as one JSON file —
              for backup and portability. Identity, integration secrets, and
              caches are excluded. Admin only.
            </p>
          </div>
        </Card>
      )}

      {isOperator && (
        <Card className="mt-6">
          <CardHeader title="Modules" />
          <div className="p-4">
            <p className="mb-4 text-xs text-ink-2">
              Which optional sections this organization can see. Core sections
              (Dashboard, Companies, Contacts, Introductions, Settings) are always
              on. Only the platform operator sees this control.
            </p>
            <ModulesForm enabled={enabledModules} />
          </div>
        </Card>
      )}

      {isOperator && (
        <Card className="mt-6">
          <CardHeader title="Data restore" />
          <div className="p-4">
            <p className="mb-4 text-xs text-ink-2">
              Replay a backup JSON into an empty organization, remapping every id
              so it shares nothing with the source. The target must be a freshly
              created, empty org. Only the platform operator sees this control.
            </p>
            <RestoreForm orgs={orgs} />
          </div>
        </Card>
      )}
    </div>
  );
}
