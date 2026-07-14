import { requireOrgContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readMemberTiers } from "@/lib/member-tiers";
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  Textarea,
} from "@/components/ui";

import { updateMemberTiers } from "./actions";

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
  const tiers = readMemberTiers(org?.settings);
  const isAdmin = ctx.role === "admin";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <PageTitle
          title="Settings"
          subtitle={`Organization configuration for ${ctx.orgName}`}
        />
      </div>

      <Card>
        <CardHeader title="Member tiers" />
        <div className="p-4">
          <p className="mb-4 text-xs text-ink-2">
            The tiers your organization uses to mark a member&rsquo;s standing.
            These appear as the Tier dropdown on each company. One per line, in
            display order.
          </p>

          {isAdmin ? (
            <form action={updateMemberTiers} className="flex flex-col gap-4">
              <Textarea
                name="tiers"
                label="Tiers (one per line)"
                rows={6}
                defaultValue={tiers.join("\n")}
                placeholder={"Chairman\nDirector\nAdvisory"}
              />
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  Save tiers
                </Button>
              </div>
            </form>
          ) : tiers.length === 0 ? (
            <p className="text-xs text-ink-3">
              No member tiers configured. An admin can set them here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tiers.map((t) => (
                <li key={t} className="text-xs text-ink">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
