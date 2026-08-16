import { PageTitle } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import type { KnowledgeKind } from "@/lib/knowledge-docs";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";

import { SopAssistant } from "./_assistant";

// Only "sop"-kind collateral grounds the assistant, so that's what we count.
const SOP_KIND: KnowledgeKind = "sop";

// SOP Assistant (knowledge layer, Step 3) — staff ask an operational question and
// get an answer grounded strictly in the org's own SOP / playbook collateral
// (KnowledgeDoc rows of kind "sop", uploaded by admins in Settings). The page is a
// thin server shell: it counts the SOPs on file for the empty-state hint, then
// hands off to the client component driving the askSop server action (so the
// Anthropic key never crosses to the browser).

export default async function SopAssistantPage() {
  await requireModule("sop_assistant");
  const { orgId } = await requireOrgContext();

  const sopCount = await withOrg(orgId, (tx) =>
    tx.knowledgeDoc.count({ where: { kind: SOP_KIND } }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle
        title="SOP Assistant"
        subtitle="Ask a question and get an answer from your own procedures."
      />
      <SopAssistant sopCount={sopCount} />
    </div>
  );
}
