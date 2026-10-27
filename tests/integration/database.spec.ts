import { exec } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import { listOrders } from "@/db/orders";
import { orderQuerySchema } from "@/lib/validation/order-query";

/**
 * Integration tests for the Phase 2 data layer. They run against the real
 * local PostgreSQL (docker compose) and skip when no DATABASE_URL exists.
 *
 * All rows created here use the `TC-TEST-` order-number prefix and a
 * `tcx-...@demo.example` email marker, and are deleted again in afterAll —
 * the test must never consume, fabricate, or destroy demo seed data.
 */
const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

const execAsync = promisify(exec);

const TEST_PREFIX = "TC-TEST-";

let prisma: PrismaClient;

describe.skipIf(!hasDatabaseUrl)("database integration", () => {
  beforeAll(() => {
    const client = getPrisma();
    if (!client) throw new Error("expected a configured Prisma client");
    prisma = client;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.order.deleteMany({
      where: { orderNumber: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  }, 30_000);

  async function createTestOrder(input: {
    number: string;
    amount: number;
    status: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    email: string;
    createdAt: Date;
  }) {
    const marker = input.email.split("@")[0];
    return prisma.order.create({
      data: {
        orderNumber: input.number,
        amount: input.amount,
        currency: "USD",
        itemCount: 2,
        customerName: `Tcx Case ${marker}`,
        customerEmail: input.email,
        shippingCountry: "Testland",
        accountAgeDays: 100,
        recentOrderCount: 0,
        shippingMismatch: false,
        orderStatus: input.status,
        createdAt: input.createdAt,
        riskAssessment: {
          create: {
            score: input.score,
            level: input.level,
            reasons: [],
            rulesVersion: "test-fixtures",
          },
        },
      },
    });
  }

  it("enforces the unique orderNumber constraint", async () => {
    await createTestOrder({
      number: `${TEST_PREFIX}UNIQ-1`,
      amount: 5_000,
      status: "PENDING",
      score: 10,
      level: "LOW",
      email: "tcx-uniq-1@demo.example",
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    await expect(
      createTestOrder({
        number: `${TEST_PREFIX}UNIQ-1`,
        amount: 9_999,
        status: "PENDING",
        score: 10,
        level: "LOW",
        email: "tcx-uniq-1b@demo.example",
        createdAt: new Date("2026-10-01T10:05:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades deletes to risk assessment, reviews, and eval labels", async () => {
    const order = await createTestOrder({
      number: `${TEST_PREFIX}CASCADE-1`,
      amount: 12_000,
      status: "APPROVED",
      score: 20,
      level: "LOW",
      email: "tcx-cascade-1@demo.example",
      createdAt: new Date("2026-10-01T11:00:00.000Z"),
    });

    await prisma.review.create({
      data: {
        orderId: order.id,
        reviewerId: "tcx-test-reviewer",
        decision: "APPROVED",
        note: "integration fixture",
      },
    });
    await prisma.evalLabel.create({
      data: { orderId: order.id, label: "ORDINARY" },
    });

    const before = await prisma.order.findUnique({
      where: { id: order.id },
      select: {
        riskAssessment: true,
        reviews: true,
        evalLabel: true,
      },
    });
    expect(before?.riskAssessment).not.toBeNull();
    expect(before?.reviews).toHaveLength(1);
    expect(before?.evalLabel).not.toBeNull();

    await prisma.order.delete({ where: { id: order.id } });

    const afterCounts = await Promise.all([
      prisma.riskAssessment.count({ where: { orderId: order.id } }),
      prisma.review.count({ where: { orderId: order.id } }),
      prisma.evalLabel.count({ where: { orderId: order.id } }),
    ]);
    expect(afterCounts).toEqual([0, 0, 0]);
  });

  it("listOrders filters by status (scoped to test rows via search marker)", async () => {
    for (const index of [1, 2]) {
      await createTestOrder({
        number: `${TEST_PREFIX}STATUS-${index}`,
        amount: 3_000 * index,
        status: "APPROVED",
        score: 12,
        level: "LOW",
        email: `tcx-status-${index}@demo.example`,
        createdAt: new Date(`2026-10-02T0${index}:00:00.000Z`),
      });
    }
    await createTestOrder({
      number: `${TEST_PREFIX}STATUS-3`,
      amount: 9_000,
      status: "HELD_FOR_REVIEW",
      score: 80,
      level: "HIGH",
      email: "tcx-status-3@demo.example",
      createdAt: new Date("2026-10-02T03:00:00.000Z"),
    });

    const result = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "tcx-status", status: "APPROVED" }),
    );
    expect(result.total).toBe(2);
    expect(result.items.every((o) => o.orderStatus === "APPROVED")).toBe(true);
    expect(result.items.every((o) => o.orderNumber.startsWith(TEST_PREFIX))).toBe(true);
  });

  it("listOrders filters by risk band combined with search", async () => {
    const [lowRow, highRow] = await Promise.all([
      createTestOrder({
        number: `${TEST_PREFIX}BAND-LOW`,
        amount: 4_000,
        status: "PENDING",
        score: 10,
        level: "LOW",
        email: "tcx-band-low@demo.example",
        createdAt: new Date("2026-10-03T10:00:00.000Z"),
      }),
      createTestOrder({
        number: `${TEST_PREFIX}BAND-HIGH`,
        amount: 190_000,
        status: "HELD_FOR_REVIEW",
        score: 92,
        level: "HIGH",
        email: "tcx-band-high@demo.example",
        createdAt: new Date("2026-10-03T10:00:00.000Z"),
      }),
    ]);
    expect(lowRow).toBeDefined();
    expect(highRow).toBeDefined();

    const result = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "tcx-band", band: "HIGH" }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]?.orderNumber).toBe(`${TEST_PREFIX}BAND-HIGH`);
    expect(result.items[0]?.risk?.score).toBe(92);
  });

  it("listOrders paginates deterministically with risk_high sort", async () => {
    const scores = [10, 50, 90, 30, 70];
    for (const [index, score] of scores.entries()) {
      await createTestOrder({
        number: `${TEST_PREFIX}PAGE-${index + 1}`,
        amount: 1_000 + score,
        status: "PENDING",
        score,
        level: score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW",
        email: `tcx-page-${index + 1}@demo.example`,
        createdAt: new Date(`2026-10-04T0${index}:00:00.000Z`),
      });
    }

    const pageOne = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "tcx-page", sort: "risk_high", pageSize: 2 }),
    );
    expect(pageOne.total).toBe(5);
    expect(pageOne.pageCount).toBe(3);
    expect(pageOne.items.map((o) => o.risk?.score)).toEqual([90, 70]);

    const pageTwo = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "tcx-page", sort: "risk_high", pageSize: 2, page: 2 }),
    );
    expect(pageTwo.items.map((o) => o.risk?.score)).toEqual([50, 30]);

    const pageThree = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "tcx-page", sort: "risk_high", pageSize: 2, page: 3 }),
    );
    expect(pageThree.items).toHaveLength(1);
    expect(pageThree.items[0]?.risk?.score).toBe(10);
  });

  it("listOrders finds a single order by order number search", async () => {
    await createTestOrder({
      number: `${TEST_PREFIX}SEARCH-42`,
      amount: 42_000,
      status: "PENDING",
      score: 44,
      level: "MEDIUM",
      email: "tcx-search-42@demo.example",
      createdAt: new Date("2026-10-05T10:00:00.000Z"),
    });

    const result = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "SEARCH-42" }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]?.orderNumber).toBe(`${TEST_PREFIX}SEARCH-42`);
    expect(result.items[0]?.customerEmail).toBe("tcx-search-42@demo.example");
  });

  it("listOrders returns an empty page (not an error) when page exceeds pageCount", async () => {
    // Phase 6 contract pin (QA review): the order explorer relies on the
    // data layer answering out-of-range pages with an empty items array so
    // the UI renders its empty state instead of an error.
    const result = await listOrders(
      prisma,
      orderQuerySchema.parse({ q: "SEARCH-42", pageSize: 12, page: 999 }),
    );
    expect(result.total).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.page).toBe(999);
    expect(result.items).toEqual([]);
  });

  it("seed guard refuses to run when orders already exist", async () => {
    await createTestOrder({
      number: `${TEST_PREFIX}GUARD-1`,
      amount: 1_000,
      status: "PENDING",
      score: 10,
      level: "LOW",
      email: "tcx-guard-1@demo.example",
      createdAt: new Date("2026-10-06T10:00:00.000Z"),
    });

    await expect(
      execAsync("npm run db:seed -- --count=600", { cwd: process.cwd() }),
    ).rejects.toThrow(/Refusing to seed/);
  }, 60_000);
});
