import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { IntroSuggestion } from "@/lib/intro-engine";

// Reader for the per-company intro-suggestion cache (intro_suggestion_caches,
// written by suggestIntros). Given a withOrg-scoped transaction client, RLS keeps
// the read inside the caller's org; the caller owns the transaction (the company
// profile folds this into its existing single withOrg pass) and this never opens
// one itself.
//
// Cached suggestions are re-filtered against IntroDismissal rows on read so a pair
// dismissed since the scan never resurfaces from the cache — self-healing, no need
// to prune the cache when a dismissal is written.

export type IntroSuggestSnapshot = {
  suggestions: IntroSuggestion[];
  meetingIntelligenceActive: boolean;
  /** ISO string — the client parses it for the freshness label. */
  generatedAt: string;
};

export async function loadIntroSuggestionSnapshot(
  tx: Prisma.TransactionClient,
  focusCompanyId: string,
): Promise<IntroSuggestSnapshot | null> {
  // RLS scopes the transaction to the caller's org, so focus_company_id alone
  // identifies at most one row (the PK is (org_id, focus_company_id)).
  const row = await tx.introSuggestionCache.findFirst({
    where: { focusCompanyId },
    select: {
      suggestions: true,
      meetingIntelligenceActive: true,
      generatedAt: true,
    },
  });
  if (row == null) return null;

  // Dismissals are stored directionally (focus -> candidate); suppress either
  // orientation touching this company, matching how suggestIntros excludes them.
  const dismissals = await tx.introDismissal.findMany({
    where: {
      OR: [
        { focusCompanyId },
        { candidateCompanyId: focusCompanyId },
      ],
    },
    select: { focusCompanyId: true, candidateCompanyId: true },
  });
  const dismissed = new Set<string>();
  for (const d of dismissals) {
    if (d.focusCompanyId === focusCompanyId) dismissed.add(d.candidateCompanyId);
    if (d.candidateCompanyId === focusCompanyId) dismissed.add(d.focusCompanyId);
  }

  const suggestions = (row.suggestions as unknown as IntroSuggestion[]).filter(
    (s) => !dismissed.has(s.companyId),
  );

  return {
    suggestions,
    meetingIntelligenceActive: row.meetingIntelligenceActive,
    generatedAt: row.generatedAt.toISOString(),
  };
}
