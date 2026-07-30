import { revalidatePath } from "next/cache";

// A single action_item can surface on several workspaces at once: the global
// Commitments list, the Meetings page (when it's a meeting action item), any
// company profile (its own company OR a cross-attributed member's), any contact
// detail ("they owe"), the originating event (a follow-up), and the dashboard
// snapshot. Mutating one therefore has to refresh all of them — otherwise an
// edit made on one surface leaves the others showing stale state (review M1).
//
// The dynamic routes use the "page" variant to bust EVERY instance, not just the
// acting id: cross-attribution means an item edited on one company's profile can
// belong to another company's contact, so the specific path isn't enough.
export function revalidateActionItemSurfaces(): void {
  revalidatePath("/dashboard/commitments");
  revalidatePath("/dashboard/meetings");
  revalidatePath("/dashboard/companies/[id]", "page");
  revalidatePath("/dashboard/contacts/[id]", "page");
  revalidatePath("/dashboard/events/[id]", "page");
  revalidatePath("/dashboard");
}
