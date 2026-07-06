import { redirect } from "next/navigation";

// The app has no marketing landing page — everything lives under /dashboard,
// which proxy.ts guards. Signed-out visitors bounce from here to /dashboard and
// then to /sign-in; signed-in visitors land in their tenant.
export default function Home() {
  redirect("/dashboard");
}
