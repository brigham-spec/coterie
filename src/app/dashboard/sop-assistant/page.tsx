import { PageTitle } from "@/components/ui";
import { requireOrgContext } from "@/lib/auth";
import { requireModule } from "@/lib/org-modules";
import { withOrg } from "@/lib/tenant";

import { SopAssistant } from "./_assistant";

// Document Assistant (knowledge layer) — staff ask any question and get an answer
// grounded strictly in the org's own uploaded collateral (all KnowledgeDoc kinds —
// decks, value props, one-pagers, SOPs, and other documents, uploaded by admins in
// Settings). The page is a thin server shell: it counts the documents on file for
// the empty-state hint, then hands off to the client component driving the askSop
// server action (so the Anthropic key never crosses to the browser).

export default async function SopAssistantPage() {
  await requireModule("sop_assistant");
  const { orgId } = await requireOrgContext();

  const docCount = await withOrg(orgId, (tx) => tx.knowledgeDoc.count());

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle
        title="Document Assistant"
        subtitle="Ask a question and get an answer from your own documents."
      />
      <SopAssistant docCount={docCount} />
    </div>
  );
}
