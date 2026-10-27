import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import { getDashboardStats } from "@/db/stats";
import { assessOrder } from "@/lib/risk/engine";

/**
 * Phase 6 reconciliation tests (QA checklist):
 * 1. Dashboard KPIs (getDashboardStats) must reconcile with direct database
 *    aggregates — the API layer's status/level/average mapping is pinned.
 * 2. Stored risk snapshots must match a FRESH run of the deterministic
 *    engine for the same inputs — scores/levels/explanations shown in the
 *    UI always come from the engine, never ad-hoc values.
 *
 * Fixtures use the TC-895x number range (disjoint from every other suite)
 * and are deleted again in afterAll.
 */
const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;

const FIXTURE_NUMBERS = ["TC-8951", "TC-8952", "TC-8953"];

type FixtureInput = {
  orderNumber: string;
  amount: number;
  currency: string;
  accountAgeDays: number;
  recentOrderCount: number;
  shippingMismatch: boolean;
  createdAt: Date;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
};

const FIXTURE_INPUTS: FixtureInput[] = [
  {
    orderNumber: "TC-8951",
    amount: 300_000,
    currency: "USD",
    accountAgeDays: 400,
    recentOrderCount: 0,
    shippingMismatch: true,
    createdAt: new Date("2026-10-27T14:30:00.000Z"),
    orderStatus: "PENDING",
  },
  {
    orderNumber: "TC-8952",
    amount: 20_000,
    currency: "USD",
    accountAgeDays: 5,
    recentOrderCount: 8,
    shippingMismatch: false,
    createdAt: new Date("2026-10-27T15:30:00.000Z"),
    orderStatus: "APPROVED",
  },
  {
    orderNumber: "TC-8953",
    amount: 300_000,
    currency: "USD",
    accountAgeDays: 3,
    recentOrderCount: 15,
    shippingMismatch: true,
    createdAt: new Date("2026-10-27T02:30:00.000Z"),
    orderStatus: "HELD_FOR_REVIEW",
  },
];

beforeAll(async () => {
  const client = getPrisma();
  if (!client) throw new Error("expected a configured Prisma client");
  prisma = client;
  await prisma.order.deleteMany({ where: { orderNumber: { in: FIXTURE_NUMBERS } } });

  // Persist each fixture WITH its engine snapshot (exactly like the seed
  // does), so the stored-vs-fresh comparison covers realistic rows.
  for (const input of FIXTURE_INPUTS) {
    const assessment = assessOrder({
      amountMinor: input.amount,
      currency: input.currency,
      accountAgeDays: input.accountAgeDays,
      recentOrderCount: input.recentOrderCount,
      shippingMismatch: input.shippingMismatch,
      placedAt: input.createdAt,
    });
    await prisma.order.create({
      data: {
        orderNumber: input.orderNumber,
        amount: input.amount,
        currency: input.currency,
        itemCount: 2,
        customerName: "Reconciliation Fixture",
        customerEmail: `${input.orderNumber.toLowerCase()}@demo.example`,
        shippingCountry: "Testland",
        accountAgeDays: input.accountAgeDays,
        recentOrderCount: input.recentOrderCount,
        shippingMismatch: input.shippingMismatch,
        orderStatus: input.orderStatus,
        createdAt: input.createdAt,
        riskAssessment: {
          create: {
            score: assessment.score,
            level: assessment.level,
            reasons: assessment.reasons as unknown as object,
            rulesVersion: assessment.rulesVersion,
          },
        },
      },
    });
  }
}, 30_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.order.deleteMany({ where: { orderNumber: { in: FIXTURE_NUMBERS } } });
  await prisma.$disconnect();
}, 30_000);

const describeIf = describe.skipIf(!hasDatabaseUrl);

describeIf("dashboard KPI reconciliation (real DB)", () => {
  it("getDashboardStats reconciles with direct database aggregates", async () => {
    const stats = await getDashboardStats(prisma);

    const [statusGroups, levelGroups, avgRow] = await Promise.all([
      prisma.order.groupBy({ by: ["orderStatus" as const], _count: { _all: true } }),
      prisma.riskAssessment.groupBy({ by: ["level" as const], _count: { _all: true } }),
      prisma.riskAssessment.aggregate({ _avg: { score: true } }),
    ]);

    const statusCount = (key: string) =>
      statusGroups.find((group) => group.orderStatus === key)?._count._all ?? 0;
    const levelCount = (key: string) =>
      levelGroups.find((group) => group.level === key)?._count._all ?? 0;

    expect(stats.totalOrders).toBe(
      statusGroups.reduce((sum, group) => sum + group._count._all, 0),
    );
    expect(stats.pending).toBe(statusCount("PENDING"));
    expect(stats.approved).toBe(statusCount("APPROVED"));
    expect(stats.held).toBe(statusCount("HELD_FOR_REVIEW"));
    expect(stats.highRisk).toBe(levelCount("HIGH"));
    expect(stats.mediumRisk).toBe(levelCount("MEDIUM"));
    expect(stats.lowRisk).toBe(levelCount("LOW"));
    expect(stats.avgRisk).toBe(avgRow._avg.score === null ? null : Math.round(avgRow._avg.score));

    // Every trend day reconciles with an independent JS-side bucketing of
    // the same rows. The day label must be deterministic UTC — flagged is
    // HIGH-band only (the stored definition).
    const allOrders = await prisma.order.findMany({
      select: { createdAt: true, riskAssessment: { select: { level: true } } },
    });
    const byDay = new Map<string, { orders: number; flagged: number }>();
    for (const order of allOrders) {
      const day = order.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { orders: 0, flagged: 0 };
      entry.orders += 1;
      if (order.riskAssessment?.level === "HIGH") entry.flagged += 1;
      byDay.set(day, entry);
    }
    const expectedDays = [...byDay.keys()]
      .filter((day) => (byDay.get(day)?.orders ?? 0) > 0)
      .sort()
      .slice(-14);
    expect(stats.trend.map((point) => point.day)).toEqual(expectedDays);
    for (const point of stats.trend) {
      const expected = byDay.get(point.day);
      expect(point.orders, `trend ${point.day} orders`).toBe(expected?.orders ?? 0);
      expect(point.flagged, `trend ${point.day} flagged`).toBe(expected?.flagged ?? 0);
    }
  });
});

describeIf("stored risk snapshots reconcile with the engine (real DB)", () => {
  it("every fixture's stored snapshot equals a fresh engine run", async () => {
    for (const input of FIXTURE_INPUTS) {
      const order = await prisma.order.findUnique({
        where: { orderNumber: input.orderNumber },
        include: { riskAssessment: true },
      });
      if (!order?.riskAssessment) throw new Error(`missing snapshot for ${input.orderNumber}`);

      const fresh = assessOrder({
        amountMinor: order.amount,
        currency: order.currency,
        accountAgeDays: order.accountAgeDays,
        recentOrderCount: order.recentOrderCount,
        shippingMismatch: order.shippingMismatch,
        placedAt: order.createdAt,
      });

      expect(order.riskAssessment.rulesVersion, input.orderNumber).toBe(fresh.rulesVersion);
      expect(order.riskAssessment.score, input.orderNumber).toBe(fresh.score);
      expect(order.riskAssessment.level, input.orderNumber).toBe(fresh.level);
      expect(
        (order.riskAssessment.reasons as { code: string }[]).map((reason) => reason.code),
        input.orderNumber,
      ).toEqual(fresh.reasons.map((reason) => reason.code));
    }
  });
});
