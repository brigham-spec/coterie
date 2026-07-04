import { serve } from "inngest/next";

import { inngest, functions } from "@/lib/inngest";

// Inngest's HTTP entry point (build item 6). Inngest invokes our functions by
// POSTing to this route; GET/PUT are used for introspection and registration.
// The route is intentionally OUTSIDE the /dashboard matcher, so Clerk does not
// gate it — Inngest authenticates with its own signing key, not a user session.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
