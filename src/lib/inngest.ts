import { Inngest, NonRetriableError } from "inngest";
import * as Sentry from "@sentry/nextjs";

import { getCredential } from "@/lib/integrations";
import { FirefliesError, listTranscripts } from "@/lib/fireflies";
import { reconcileTranscripts } from "@/lib/fireflies-reconcile";
import { autoExtractActionItems } from "@/lib/auto-action-items";
import { enrichLinkedinContacts } from "@/lib/linkedin-enrich-run";
import { firefliesSyncErrorMessage } from "@/lib/sync-status";
import { withOrg } from "@/lib/tenant";

// Inngest client + function registry (build item 6, spec §8). Inngest runs our
// background jobs — the Fireflies meeting sync is the first real one. Jobs are
// durable and retried, so a flaky external API doesn't drop a sync.
//
// Every job that touches tenant data MUST scope through withOrg (cardinal rule
// #1): the org_id travels in the event payload, never inferred from ambient
// state. Inngest has no request/auth context of its own, so the triggering code
// is responsible for stamping the correct org_id onto the event.

export const inngest = new Inngest({ id: "coterie" });

// A no-op job used to verify the Inngest wiring end-to-end (event received →
// function ran) before any real sync exists. Safe to keep — it touches nothing.
export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "coterie/ping" }] },
  async () => ({ ok: true, ranAt: new Date().toISOString() }),
);

// Pull recent Fireflies transcripts for one org and reconcile them into Meeting
// rows + matched attendees via the shared reconcileTranscripts — see
// fireflies-reconcile.ts for the (idempotent, withOrg-scoped) reconcile contract.
// This job owns only the full-sync concerns the shared path deliberately leaves
// out: validating the org_id off the event payload and stamping the sync clock.
export const syncFireflies = inngest.createFunction(
  { id: "fireflies-sync", triggers: [{ event: "coterie/fireflies.sync" }] },
  async ({ event }) => {
    // Inngest carries no auth context — the org_id is the only tenant signal, so
    // validate it explicitly. A malformed event is a bug, not a transient
    // failure, so don't retry it.
    const data = event.data as { orgId?: unknown };
    if (typeof data.orgId !== "string" || data.orgId === "")
      throw new NonRetriableError("fireflies.sync event missing orgId");
    const orgId = data.orgId;

    const credential = await getCredential(orgId, "fireflies");
    if (credential == null)
      return { meetings: 0, attendees: 0, reason: "no fireflies credential" };

    let result: Awaited<ReturnType<typeof reconcileTranscripts>>;
    try {
      const transcripts = await listTranscripts(credential.accessToken);

      // Reconcile the pulled transcripts into Meeting rows + matched attendees
      // (the same idempotent path the profile "paste a Fireflies ID" import uses).
      result = await reconcileTranscripts(orgId, transcripts);
    } catch (err) {
      // Background failures were previously silent — the operator saw only a
      // stale "last synced" clock. Persist the failure (specific for a bad key,
      // via the same classifier the synchronous "Sync now" preflight uses) so the
      // meetings Fireflies card can surface it, then re-throw so Inngest's durable
      // retry still runs. The latest attempt's message stands until a sync wins.
      const message =
        err instanceof FirefliesError
          ? firefliesSyncErrorMessage(err.status, err.message)
          : err instanceof Error
            ? err.message
            : "Sync failed.";
      await withOrg(orgId, (tx) =>
        tx.integrationCredential.updateMany({
          where: { provider: "fireflies" },
          data: { lastSyncError: message.slice(0, 500) },
        }),
      );
      throw err;
    }

    // Stamp the sync clock so the dashboard sync-status card can report
    // freshness, and clear any prior failure now that a sync has succeeded.
    // updateMany (not update) keeps this a no-op-safe write scoped by RLS — a
    // missing credential row simply updates nothing. This is a full-sync concern,
    // so it stays here rather than in the shared reconcile.
    await withOrg(orgId, (tx) =>
      tx.integrationCredential.updateMany({
        where: { provider: "fireflies" },
        data: { lastSyncedAt: new Date(), lastSyncError: null },
      }),
    );

    // Auto-extract action items for the meetings this run created, so the
    // operator arrives to a populated worklist instead of extracting each one by
    // hand. This runs AFTER the sync clock is stamped: the reconcile (the durable
    // work) has already succeeded, so an extraction hiccup must not fail the sync
    // or trip a retry that would re-reconcile. It's best-effort and self-bounds to
    // newly-created meetings (see auto-action-items.ts).
    let actionItems = 0;
    try {
      actionItems = await autoExtractActionItems(orgId, result.createdMeetingIds);
    } catch (err) {
      // Swallow — a successful sync should never be undone by extraction. The
      // manual "Extract" button remains available for these meetings. Log it so
      // a persistent extraction failure isn't silently invisible.
      console.error("auto-extract action items failed after sync:", err);
    }

    return { ...result, actionItems };
  },
);

// Bulk-enrich a tenant's un-enriched LinkedIn connections in the background. The
// import lands raw rows fast (invisible to recall until enriched); this job fills
// the inferred dimensions afterward so a 1,000+ export doesn't block the upload.
//
// enrichLinkedinContacts does a bounded slice of work per invocation (batches,
// capped) and reports whether a backlog remains. When it does, the job sleeps
// past the per-minute AI cap and re-sends its own trigger event — draining the
// backlog across as many invocations as it takes, terminating when no un-enriched
// rows are left. Idempotent: only enrichedAt:null rows are ever touched.
export const enrichLinkedin = inngest.createFunction(
  { id: "linkedin-enrich", triggers: [{ event: "coterie/linkedin.enrich" }] },
  async ({ event, step }) => {
    // No auth context here — the org_id is the only tenant signal, so validate it
    // explicitly. A malformed event is a bug, not a transient failure; don't retry.
    const data = event.data as { orgId?: unknown };
    if (typeof data.orgId !== "string" || data.orgId === "")
      throw new NonRetriableError("linkedin.enrich event missing orgId");
    const orgId = data.orgId;

    const result = await step.run("enrich-batch", () =>
      enrichLinkedinContacts(orgId),
    );

    // Backlog left (per-run ceiling or the org's AI cap) → cool down past the
    // per-minute window, then re-trigger to resume. Chains until fully drained.
    if (result.remaining) {
      await step.sleep("ai-cooldown", "1m");
      await step.sendEvent("continue-linkedin-enrich", {
        name: "coterie/linkedin.enrich",
        data: { orgId },
      });
    }

    return result;
  },
);

// Catch-all alerting for background jobs. Inngest's Hobby plan has no dashboard
// alerting, so a job exhausting its retries would otherwise fail silently. Inngest
// emits the system event `inngest/function.failed` after a function's final retry
// fails; we forward it to Sentry (which emails on new issues), giving background
// failures the same reach as app errors without standing up a separate mailer.
export const reportFailure = inngest.createFunction(
  { id: "report-failure", triggers: [{ event: "inngest/function.failed" }] },
  async ({ event }) => {
    const data = event.data as {
      function_id?: unknown;
      run_id?: unknown;
      error?: { message?: unknown; name?: unknown };
    };
    const functionId =
      typeof data.function_id === "string" ? data.function_id : "unknown";
    const message =
      typeof data.error?.message === "string"
        ? data.error.message
        : "Inngest function failed";

    Sentry.captureException(new Error(`Inngest job failed: ${message}`), {
      tags: { source: "inngest", function_id: functionId },
      extra: {
        run_id: typeof data.run_id === "string" ? data.run_id : undefined,
        error_name:
          typeof data.error?.name === "string" ? data.error.name : undefined,
      },
    });
    // Background functions are short-lived; flush before returning so the event
    // isn't dropped when the invocation ends.
    await Sentry.flush(2000);
    return { reported: true, functionId };
  },
);

// Registered with the serve route (src/app/api/inngest/route.ts).
export const functions = [ping, syncFireflies, enrichLinkedin, reportFailure];
