import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseUrl } from "@/lib/env";

/**
 * Prisma client singleton for Next.js development hot reloads: the global
 * guard prevents connection-intake growth across dev-server reloads.
 * Returns null in Phase 2 when no DATABASE_URL is configured — the API
 * layer renders honest degradation for that case.
 */

type PrismaGlobal = typeof globalThis & {
  __trustcartPrisma?: PrismaClient;
};

const globalForPrisma = globalThis as PrismaGlobal;

export function getPrisma(): PrismaClient | null {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;

  if (!globalForPrisma.__trustcartPrisma) {
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    globalForPrisma.__trustcartPrisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__trustcartPrisma;
}
