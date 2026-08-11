import { requireOrgContext } from "@/lib/auth";
import { exportTenantData } from "@/lib/tenant-export";

// Tenant data export download (admin only). Streams the org's own data as one
// versioned JSON attachment — the backup/portability half of item 4. Admin-gated
// like the activity log: a non-admin gets a bare 404 so the route's existence
// stays hidden from staff, rather than a thrown ForbiddenError. The export itself
// is RLS-scoped inside exportTenantData, so a caller only ever gets their org.

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

export async function GET(): Promise<Response> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") return new Response("Not found", { status: 404 });

  const data = await exportTenantData(ctx.orgId, ctx.orgName);
  const stamp = data.exportedAt.slice(0, 10);
  const filename = `coterie-export-${slugify(ctx.orgName)}-${stamp}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
