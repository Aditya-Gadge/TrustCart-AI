import { NextResponse } from "next/server";
import { getPrisma } from "@/db/client";
import { getDashboardStats } from "@/db/stats";

/**
 * GET /api/stats — dashboard aggregates over stored risk-engine snapshots.
 * - no database configured → 503 database_unconfigured (UI shows labelled
 *   demo fallback)
 * - database unreachable → 503 database_unreachable
 */
export async function GET() {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "database_unconfigured" }, { status: 503 });
  }

  try {
    const stats = await getDashboardStats(prisma);
    return NextResponse.json(stats, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[api/stats] database error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "database_unreachable" }, { status: 503 });
  }
}
