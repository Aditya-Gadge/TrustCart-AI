import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Dashboard aggregates (Phase 3) computed from stored risk-engine outputs —
 * the same deterministic snapshots the order list and investigation pages
 * display. No client input reaches these queries.
 */

export type TrendPoint = { day: string; orders: number; flagged: number };

export type DashboardStats = {
  totalOrders: number;
  pending: number;
  approved: number;
  held: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  avgRisk: number | null;
  trend: TrendPoint[];
};

type TrendRow = { day: Date; orders: number | string; flagged: number | string };

export async function getDashboardStats(prisma: PrismaClient): Promise<DashboardStats> {
  const [statusGroups, levelGroups, avg, trendRows] = await Promise.all([
    prisma.order.groupBy({ by: ["orderStatus" as const], _count: { _all: true } }),
    prisma.riskAssessment.groupBy({ by: ["level" as const], _count: { _all: true } }),
    prisma.riskAssessment.aggregate({ _avg: { score: true } }),
    // Tagged template with NO interpolated client input → parameterization is
    // static; flagged = stored HIGH-band assessments only.
    prisma.$queryRaw<TrendRow[]>`
      SELECT date_trunc('day', o."createdAt") AS day,
             count(*)::bigint AS orders,
             count(*) FILTER (WHERE ra."level" = 'HIGH')::bigint AS flagged
      FROM "Order" o
      LEFT JOIN "RiskAssessment" ra ON ra."orderId" = o.id
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 14
    `,
  ]);

  const byStatus = new Map(statusGroups.map((g) => [g.orderStatus, g._count._all]));
  const byLevel = new Map(levelGroups.map((g) => [g.level, g._count._all]));

  return {
    totalOrders: [...byStatus.values()].reduce((sum, n) => sum + n, 0),
    pending: byStatus.get("PENDING") ?? 0,
    approved: byStatus.get("APPROVED") ?? 0,
    held: byStatus.get("HELD_FOR_REVIEW") ?? 0,
    highRisk: byLevel.get("HIGH") ?? 0,
    mediumRisk: byLevel.get("MEDIUM") ?? 0,
    lowRisk: byLevel.get("LOW") ?? 0,
    avgRisk: avg._avg.score === null ? null : Math.round(avg._avg.score),
    trend: trendRows
      .map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        orders: Number(row.orders),
        flagged: Number(row.flagged),
      }))
      .reverse(),
  };
}
