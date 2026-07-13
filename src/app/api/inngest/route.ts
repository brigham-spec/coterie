import { serve } from "inngest/next";

import { inngest, functions } from "@/lib/inngest";

// Inngest's HTTP entry point (build item 6). Inngest invokes our functions by
// POSTing to this route; GET/PUT are used for introspection and registration.
// The route is intentionally OUTSIDE the /dashboard matcher, so Clerk does not
// gate it — Inngest authenticates with its own signing key, not a user session.
//
// That signing key is the ONLY thing standing between this public route and an
// unauthenticated caller triggering background jobs. Inngest silently skips
// signature verification when INNGEST_SIGNING_KEY is unset (a dev convenience),
// so a production deploy that forgot the key would leave the endpoint open. Fail
// fast at module load instead: in production the key is mandatory. The check is
// skipped during `next build` (NEXT_PHASE=phase-production-build), where env
// secrets aren't present and no request is ever served — it only guards the
// running server.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.INNGEST_SIGNING_KEY
) {
  throw new Error(
    "INNGEST_SIGNING_KEY is required in production — the Inngest route would otherwise accept unauthenticated requests.",
  );
}

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
