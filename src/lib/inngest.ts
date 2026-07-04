import { Inngest } from "inngest";

// Inngest client + function registry (build item 6, spec §8). Inngest runs our
// background jobs — the Fireflies meeting sync (slice 4) is the first real one.
// Jobs are durable and retried, so a flaky external API doesn't drop a sync.
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

// Registered with the serve route (src/app/api/inngest/route.ts).
export const functions = [ping];
