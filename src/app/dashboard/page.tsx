import { redirect } from "next/navigation";

// /dashboard has no view of its own yet — Companies is the network's home.
// (This is the future seat of the overview/dashboard surface; until it exists,
// send callers straight to the companies list.)

export default function DashboardPage() {
  redirect("/dashboard/companies");
}
