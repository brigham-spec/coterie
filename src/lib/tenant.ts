import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Run a unit of work scoped to a single tenant.
 *
 * Opens a transaction, sets the transaction-local GUC `app.org_id`, then hands
 * the caller a transaction client. Every query issued on that client is subject
 * to the RLS policies (see prisma/migrations/*_tenant_rls), so it can only read
 * or write rows belonging to `orgId`. This is the ONLY sanctioned way to touch
 * tenant-scoped tables — never query them off the bare `prisma` client, which
 * has no org context and RLS will (correctly) return nothing.
 *
 * `set_config(..., true)` makes the setting local to this transaction, so it
 * cannot leak onto another request sharing a pooled connection.
 */
export function withOrg<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    return work(tx);
  });
}
