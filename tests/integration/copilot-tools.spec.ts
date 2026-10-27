import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import { REASON_META } from "@/lib/risk/rules";
import { executeToolCall } from "@/lib/ai/tools";

/**
 * Live-database tests for the copilot's read-only tool executor (Phase 4).
 * These prove the model-facing tool surface: fixed tool set, Zod-validated
 * args, real stored data retrieval, and evidence registration. Skips without
 * DATABASE_URL. Fixture rows use the TC-TEST- prefix and are removed after.
 */
const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;
let fixtureOrderId: string;
let fixtureOrderNumber: string;

beforeAll(async () => {
  const client = getPrisma();
  if (!client) throw new Error("expected a configured Prisma client");
  prisma = client;

  // One HELD fixture that fires DEMO_HIGH_VALUE (USD tier 1) and nothing else.
  // The order number follows the real demo format (TC-<digits>) because the
  // copilot's arg validation enforces it — pick an unused high range.
  const existing = await prisma.order.findUnique({ where: { orderNumber: "TC-9876" } });
  if (existing) {
    await prisma.order.delete({ where: { orderNumber: "TC-9876" } });
  }
  const order = await prisma.order.create({
    data: {
      orderNumber: "TC-9876",
      amount: 95_000,
      currency: "USD",
      itemCount: 1,
      customerName: "Tcx Copilot Fixture",
      customerEmail: "tcx-copilot@demo.example",
      shippingCountry: "Testland",
      accountAgeDays: 400,
      recentOrderCount: 0,
      shippingMismatch: false,
      orderStatus: "HELD_FOR_REVIEW",
      createdAt: new Date(),
      riskAssessment: {
        create: {
          score: 12,
          level: "LOW",
          rulesVersion: "demo-heuristics-v1",
          reasons: [
            {
              code: "DEMO_HIGH_VALUE",
              label: "Unusually high order value",
              points: 12,
              explanation: "The order total exceeds the demo high-value threshold for its currency.",
              evidence: [
                { label: "Order total", value: "$950.00 USD" },
                { label: "Threshold", value: "≥ $800.00 USD" },
              ],
            },
          ],
        },
      },
    },
    include: { riskAssessment: true },
  });
  fixtureOrderId = order.id;
  fixtureOrderNumber = order.orderNumber;
}, 30_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.order.deleteMany({ where: { orderNumber: "TC-9876" } });
  await prisma.$disconnect();
}, 30_000);

describe.skipIf(!hasDatabaseUrl)("copilot tool executor (read-only, live DB)", () => {
  it("rejects unknown tools before any database access", async () => {
    const execution = await executeToolCall(prisma, "run_sql", { sql: "DROP TABLE \"Order\";" });
    expect(execution.ok).toBe(false);
    expect(execution.result.error).toBe("unknown_tool");
    expect(execution.citations).toHaveLength(0);
  });

  it("rejects shell-like and oversized identifiers via arg validation", async () => {
    const shell = await executeToolCall(prisma, "get_order_investigation", {
      orderNumber: "TC-1; rm -rf /",
    });
    expect(shell.result.error).toBe("invalid_args");

    const huge = await executeToolCall(prisma, "get_order_investigation", {
      orderId: "x".repeat(500),
    });
    expect(huge.result.error).toBe("invalid_args");
  });

  it("retrieves a real stored order context with its risk reasons and citations", async () => {
    const byNumber = await executeToolCall(prisma, "get_order_investigation", {
      orderNumber: fixtureOrderNumber,
    });
    expect(byNumber.ok).toBe(true);
    expect(byNumber.result).toMatchObject({ found: true });
    const order = byNumber.result.order as { orderNumber: string; risk: { score: number } | null };
    expect(order.orderNumber).toBe(fixtureOrderNumber);
    expect(order.risk).not.toBeNull();
    expect(byNumber.citations).toEqual([
      {
        orderId: fixtureOrderId,
        orderNumber: fixtureOrderNumber,
        reasonCodes: ["DEMO_HIGH_VALUE"],
      },
    ]);

    const byId = await executeToolCall(prisma, "get_order_investigation", { orderId: fixtureOrderId });
    expect(byId.result).toMatchObject({ found: true });
  });

  it("reports not_found honestly for unknown orders", async () => {
    const execution = await executeToolCall(prisma, "get_order_investigation", {
      orderNumber: "TC-000000",
    });
    expect(execution.ok).toBe(true);
    expect(execution.result).toMatchObject({ found: false });
    expect(execution.citations).toHaveLength(0);
  });

  it("returns capped order lists for awaiting-review questions", async () => {
    const execution = await executeToolCall(prisma, "list_orders_awaiting_review", { limit: 5 });
    expect(execution.ok).toBe(true);
    const rows = execution.result.orders as { orderStatus: string }[];
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const row of rows) {
      expect(["HELD_FOR_REVIEW", "PENDING"]).toContain(row.orderStatus);
    }
    expect(execution.citations.length).toBe((execution.result.count as number) || 0);
  });

  it("aggregates stored risk signals with human labels", async () => {
    const execution = await executeToolCall(prisma, "get_top_risk_signals", { limit: 5 });
    expect(execution.ok).toBe(true);
    const signals = execution.result.signals as { code: string; label: string; orders: number }[];
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(Object.keys(REASON_META)).toContain(signal.code);
      expect(signal.label).toBe(REASON_META[signal.code as keyof typeof REASON_META]?.label);
    }
  });

  it("never mutates data through any tool path (scoped to the fixture row)", async () => {
    // Global counts shift when other integration suites run in parallel, so
    // the read-only invariant is asserted on rows scoped to the fixture order.
    const scopedCounts = async () => ({
      reviews: await prisma.review.count({ where: { orderId: fixtureOrderId } }),
      assessments: await prisma.riskAssessment.count({ where: { orderId: fixtureOrderId } }),
      audits: await prisma.auditEvent.count({
        where: { entityType: "ORDER", entityId: fixtureOrderId },
      }),
    });
    const before = await scopedCounts();
    await executeToolCall(prisma, "list_orders_awaiting_review", { limit: 1 });
    await executeToolCall(prisma, "search_orders", { q: "Tcx", limit: 1 });
    await executeToolCall(prisma, "get_dashboard_stats", {});
    await executeToolCall(prisma, "get_top_risk_signals", { limit: 3 });
    await executeToolCall(prisma, "get_order_investigation", { orderNumber: fixtureOrderNumber });
    const after = await scopedCounts();
    expect(after).toEqual(before);
  });
});
