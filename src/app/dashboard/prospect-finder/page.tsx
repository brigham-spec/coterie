import { PageTitle } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { TERMINAL_STAGES } from "@/lib/project-stages";

import { ProspectFinder } from "./_finder";

// Prospect Finder (slice 11.6) — external discovery of NEW organisations via
// web search, distinct from Network Search (which searches the tenant's own
// companies). The page is a thin server shell: it loads the small context
// summary shown in the recommendations panel, then hands off to the client
// component driving the findProspects / addProspect server actions (so the
// Anthropic key never crosses to the browser).

export default async function ProspectFinderPage() {
  const { orgId } = await requireOrgContext();

  const context = await withOrg(orgId, async (tx) => {
    const companies = await tx.company.findMany({
      where: { status: { not: "former" } },
      select: { industry: true, status: true, lookingFor: true },
    });
    const activeProjects = await tx.project.count({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
    });
    const members = companies.filter((c) =>
      ["member", "strategic_partner"].includes(c.status),
    );
    return {
      memberCount: members.length,
      industryCount: new Set(members.map((c) => c.industry).filter(Boolean)).size,
      needsCount: members.filter((c) => c.lookingFor).length,
      activeProjects,
    };
  });

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle
        title="Prospect Finder"
        subtitle="Discover new organisations to add to your network."
      />
      <ProspectFinder context={context} />
    </div>
  );
}
