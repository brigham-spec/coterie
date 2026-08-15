import "server-only";

import { AiRateLimitError, enforceAiRateLimit } from "@/lib/ai-rate-limit";
import {
  generateLinkedinEnrichments,
  LINKEDIN_INFERRED_SOURCE,
  type LinkedinEnrichInput,
} from "@/lib/linkedin-enrich";
import { withOrg } from "@/lib/tenant";

// The batch runner behind LinkedIn bulk enrichment. Drains a tenant's un-enriched
// connections in bounded batches, calling the AI seam once per batch and stamping
// the inferred dimensions onto each row. Designed for a 1,000+ import: it does a
// slice of work, reports whether more remains, and lets the Inngest job re-invoke
// it after a cooldown so a run stays well under any single-invocation budget and
// respects the per-org AI cap.
//
// Forward progress is guaranteed: every row processed gets `enrichedAt` stamped —
// even one the model couldn't classify (its dimensions stay null). A stamped row
// with null dimensions is an honest "we looked, no basis" state, NOT a permanent
// retry, so a run always terminates. Only enrichedAt:null rows are touched, so a
// re-run is idempotent and never re-pays for an already-enriched person.

// People per model call. Small enough that one withOrg tx of sequential updates
// stays far under the interactive-tx timeout; large enough to amortize the call.
const BATCH_SIZE = 25;

// Hard ceiling on batches per invocation so a single run is bounded regardless of
// backlog. The Inngest job re-invokes to drain whatever remains.
const MAX_BATCHES = 40;

export interface EnrichRunResult {
  scanned: number; // rows stamped this run (classified or not)
  enriched: number; // rows that got at least one inferred dimension
  remaining: boolean; // true if un-enriched rows are still left after this run
}

/// Enrich up to MAX_BATCHES worth of un-enriched connections for one org. Returns
/// how many rows were stamped, how many got a real inference, and whether more
/// remain (so the caller can schedule a continuation). Stops early — reporting
/// remaining:true — when the org hits its AI cap, leaving the rest for the next run.
export async function enrichLinkedinContacts(
  orgId: string,
): Promise<EnrichRunResult> {
  let scanned = 0;
  let enriched = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await withOrg(orgId, (tx) =>
      tx.linkedinContact.findMany({
        where: { enrichedAt: null },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true, fullName: true, company: true, title: true },
      }),
    );
    if (rows.length === 0) return { scanned, enriched, remaining: false };

    // Charge one AI call before the paid seam. Over the org's cap → stop and
    // report work remaining rather than burning a retry; the next run resumes.
    try {
      await enforceAiRateLimit(orgId);
    } catch (err) {
      if (err instanceof AiRateLimitError)
        return { scanned, enriched, remaining: true };
      throw err;
    }

    // Row index is the ref, so a returned entry maps back positionally and a
    // hallucinated/missing ref is simply dropped by the parser.
    const inputs: LinkedinEnrichInput[] = rows.map((row, i) => ({
      ref: String(i),
      fullName: row.fullName,
      company: row.company,
      title: row.title,
    }));
    const results = await generateLinkedinEnrichments(inputs);
    const byRef = new Map(results.map((r) => [r.ref, r]));
    const now = new Date();

    await withOrg(orgId, async (tx) => {
      // Sequential updates: one pooled connection per withOrg tx.
      for (let i = 0; i < rows.length; i++) {
        const r = byRef.get(String(i));
        const gotDimension =
          r != null &&
          (r.industry != null || r.seniority != null || r.jobFunction != null);
        await tx.linkedinContact.updateMany({
          where: { id: rows[i].id },
          data: {
            industry: r?.industry ?? null,
            industrySource: r?.industry != null ? LINKEDIN_INFERRED_SOURCE : null,
            industryConfidence: r?.industryConfidence ?? null,
            seniority: r?.seniority ?? null,
            senioritySource: r?.seniority != null ? LINKEDIN_INFERRED_SOURCE : null,
            seniorityConfidence: r?.seniorityConfidence ?? null,
            jobFunction: r?.jobFunction ?? null,
            jobFunctionSource:
              r?.jobFunction != null ? LINKEDIN_INFERRED_SOURCE : null,
            jobFunctionConfidence: r?.jobFunctionConfidence ?? null,
            enrichedAt: now,
          },
        });
        scanned++;
        if (gotDimension) enriched++;
      }
    });
  }

  // Hit the per-run batch ceiling — report whether a backlog is still waiting.
  const left = await withOrg(orgId, (tx) =>
    tx.linkedinContact.count({ where: { enrichedAt: null } }),
  );
  return { scanned, enriched, remaining: left > 0 };
}
