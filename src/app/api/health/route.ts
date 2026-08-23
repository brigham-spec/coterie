import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Liveness + database-connectivity probe for uptime monitoring (e.g. Better
// Uptime / Checkly ping this on an interval). It sits OUTSIDE the /dashboard
// matcher in proxy.ts, so no Clerk session is required — an external pinger can
// reach it. It deliberately touches NO tenant data: a plain `SELECT 1` only
// proves the server is up and can reach Postgres, so RLS/withOrg do not apply.
//
// Contract for the pinger: HTTP 200 = healthy, HTTP 503 = the DB is
// unreachable. Alert on any non-200. The body carries a little detail for a
// human reading the response, but the status code is the signal.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "ok",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Log so the failure also lands in Vercel logs (and, once wired, Sentry).
    console.error("[health] database check failed", err);
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
