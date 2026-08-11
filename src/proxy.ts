import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Next 16 renamed the `middleware` convention to `proxy`. Clerk session
// handling runs on every request; the per-request app.org_id used by Postgres
// RLS is set in the data layer via withOrg (see src/lib/tenant.ts).
//
// Route-level protection (build item 4): /dashboard and everything under it
// require a session. Unauthenticated requests are redirected to sign-in before
// reaching the tenant-scoped pages.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

// The app is served on app.coterienmt.ai; the apex (and www) serve the marketing
// landing. Same deployment, split by host: on a marketing host we rewrite "/" to
// the /site landing, leaving the app subdomain's root untouched. Harmless until
// the apex DNS actually points at Vercel.
const MARKETING_HOSTS = new Set(["coterienmt.ai", "www.coterienmt.ai"]);

export default clerkMiddleware(async (auth, req) => {
  const host = req.headers.get("host")?.split(":")[0] ?? "";
  if (MARKETING_HOSTS.has(host) && req.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/site", req.url));
  }
  if (isProtectedRoute(req)) await auth.protect();
});

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
