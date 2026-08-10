import { redirect } from "next/navigation";

import { auth } from "@clerk/nextjs/server";

// The app has no marketing landing page — everything lives under /dashboard.
// Branch on the session so the bare domain lands cleanly: signed-out visitors
// go straight to /sign-in (proxy.ts's auth.protect() 404s them at /dashboard
// rather than redirecting, so we can't route them through it), signed-in
// visitors land in their tenant.
export default async function Home() {
  const { userId } = await auth();
  redirect(userId ? "/dashboard" : "/sign-in");
}
