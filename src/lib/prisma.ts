import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 connects through a driver adapter rather than a bundled engine.
// Pool config is tuned for serverless: many concurrent lambdas each hold their
// own pool, so we keep each one's footprint small and, crucially, fail fast when
// no connection is available instead of blocking until the function times out
// and returns a 503. The Neon *pooled* endpoint (DATABASE_URL) multiplexes these
// across a small backend pool; DIRECT_URL stays on the direct endpoint for
// migrations.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

// Reuse a single PrismaClient across hot reloads in dev to avoid exhausting
// database connections. In production a fresh instance per lambda is fine.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
