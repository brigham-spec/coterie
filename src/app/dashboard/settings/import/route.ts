import { requireOrgContext } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/prisma";
import { importTenantData } from "@/lib/tenant-import";
import type { TenantExport } from "@/lib/tenant-export";

// Operator-only tenant restore — the inverse of settings/export, but a PLATFORM
// operation: it writes a DIFFERENT organization than the caller's own, so it is
// gated by isPlatformAdmin rather than the tenant-admin gate the export route
// uses. A customer (even a tenant admin) gets a bare 404, so the route's
// existence stays hidden. POST the versioned export envelope as the JSON body
// with ?targetOrgId=<uuid>; importTenantData replays the graph into that empty
// org with fresh ids and enforces the version + empty-target guards itself.

function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Structural guard so request.json()'s `unknown` can be handed to
// importTenantData as a TenantExport. The deeper version + shape validation lives
// in importTenantData, which this route surfaces as a 409.
function isTenantExport(value: unknown): value is TenantExport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.tables === "object" &&
    v.tables !== null
  );
}

export async function POST(request: Request): Promise<Response> {
  const ctx = await requireOrgContext();
  if (!isPlatformAdmin(ctx)) return new Response("Not found", { status: 404 });

  const targetOrgId = new URL(request.url).searchParams
    .get("targetOrgId")
    ?.trim();
  if (!targetOrgId) return fail("targetOrgId query parameter is required", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("request body is not valid JSON", 400);
  }
  if (!isTenantExport(body)) {
    return fail("request body is not a tenant export", 400);
  }

  // organizations carries no RLS (it's a platform table), so this is a plain
  // read. Confirm the target exists before opening the restore transaction.
  const org = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true },
  });
  if (!org) return fail(`target org ${targetOrgId} does not exist`, 404);

  try {
    const summary = await importTenantData(targetOrgId, body);
    return Response.json(summary);
  } catch (err) {
    // A version mismatch or a non-empty target is an operator-correctable
    // condition, not a server fault — surface it as a 409 with the reason.
    const message = err instanceof Error ? err.message : "import failed";
    return fail(message, 409);
  }
}
