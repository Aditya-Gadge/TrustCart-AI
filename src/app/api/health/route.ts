import { NextResponse } from "next/server";
import { getPrisma } from "@/db/client";

/**
 * GET /api/health — deployment liveness probe.
 *
 * Returns 200 whenever the app is serving (the app is designed to degrade
 * gracefully without a database); the body reports the database state
 * honestly (`connected` / `unconfigured` / `unreachable`). No data and no
 * secrets are returned. Use this as the hosting provider's health-check path.
 */
export async function GET() {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json(
      { status: "ok", database: "unconfigured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[api/health] database check failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { status: "ok", database: "unreachable" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
