import { clerkMiddleware } from "@clerk/nextjs/server";

// Next 16 renamed the `middleware` convention to `proxy`. Clerk session
// handling runs on every request. Route-level protection (and the per-request
// app.org_id used by Postgres RLS via withOrg) is layered on in later
// build-order items; for now this just establishes the auth context.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for Clerk's auto-proxy path.
    "/__clerk/:path*",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
