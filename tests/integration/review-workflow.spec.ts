import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import { POST as reviewPost } from "@/app/api/orders/[id]/review/route";
import { GET as statsGet } from "@/app/api/stats/route";

/**
 * Integration tests for the Phase 3 review workflow: validation, transition
 * matrix, optimistic concurrency (including two concurrent submissions),
 * repeated requests, risk-snapshot persistence, and audit persistence.
 * Runs against the real local PostgreSQL; skips without DATABASE_URL.
 * All fixture rows use the TC-TEST- prefix and are removed in afterAll.
 */
const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;

const TEST_PREFIX = "TC-REV-";

async function makeRequest(orderId: string, body: unknown): Promise<Response> {
  const request = new NextRequest("http://localhost:3000/api/orders/x/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return reviewPost(request, { params: Promise.resolve({ id: orderId }) });
}

async function createTestOrder(input: {
  number: string;
  status: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
}): Promise<{ id: string; updatedAt: string; score: number; level: "LOW" | "MEDIUM" | "HIGH" }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: input.number,
      amount: 95_000, // fires DEMO_HIGH_VALUE under demo-heuristics-v1 (USD tier 1)
      currency: "USD",
      itemCount: 2,
      customerName: `Tcx Review ${input.number.slice(-4)}`,
      customerEmail: `tcx-review-${input.number.slice(-4).toLowerCase()}@demo.example`,
      shippingCountry: "Testland",
      accountAgeDays: 400,
      recentOrderCount: 0,
      shippingMismatch: false,
      orderStatus: input.status,
      createdAt: new Date(),
    },
  });
  return { id: order.id, updatedAt: order.updatedAt.toISOString(), score: 12, level: "LOW" };
}

describe.skipIf(!hasDatabaseUrl)("review workflow integration", () => {
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

  it("approves a pending order, persists decision + audit + fresh snapshot", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-A`, status: "PENDING" });
    const res = await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "Customer history verified with the merchant feed",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      order: { orderStatus: string; updatedAt: string };
      fromStatus: string;
      toStatus: string;
    };
    expect(body.fromStatus).toBe("PENDING");
    expect(body.toStatus).toBe("APPROVED");

    // Decision persisted with the server-side demo actor and the reason.
    const review = await prisma.review.findFirstOrThrow({
      where: { orderId: fixture.id },
      orderBy: { createdAt: "desc" },
    });
    expect(review.decision).toBe("APPROVED");
    expect(review.reviewerId).toBe("demo-merchant");
    expect(review.note).toBe("Customer history verified with the merchant feed");

    // Fresh deterministic snapshot persisted with the current rules version.
    const assessment = await prisma.riskAssessment.findUniqueOrThrow({
      where: { orderId: fixture.id },
    });
    expect(assessment.rulesVersion).toBe("demo-heuristics-v1");
    expect(assessment.score).toBe(fixture.score);
    expect(assessment.level).toBe(fixture.level);

    // Audit event records actor, from/to, and the reason.
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "ORDER", entityId: fixture.id, action: "REVIEW_STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actor).toBe("demo-merchant");
    const meta = audit.metadata as Record<string, unknown>;
    expect(meta.fromStatus).toBe("PENDING");
    expect(meta.toStatus).toBe("APPROVED");
    expect(meta.reason).toBe("Customer history verified with the merchant feed");
    expect(meta.reviewId).toBe(review.id);
  });

  it("rejects a repeated request on the same transition (422 invalid_transition)", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-B`, status: "PENDING" });
    const first = await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "First decision recorded by the reviewer",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(first.status).toBe(200);

    const second = await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "Repeated identical request after the first succeeded",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(second.status).toBe(422);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("invalid_transition");
  });

  it("rejects stale writes with 409 instead of overwriting (optimistic concurrency)", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-C`, status: "PENDING" });
    // First decision lands, changing updatedAt.
    await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "The decision that legitimately changed the row first",
      expectedUpdatedAt: fixture.updatedAt,
    });
    // A second reviewer still holds the ORIGINAL updatedAt → conflict, not overwrite.
    const stale = await makeRequest(fixture.id, {
      action: "HOLD",
      reason: "Second reviewer acting on a now-outdated page render",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; currentUpdatedAt: string };
    expect(body.error).toBe("stale_write");
    expect(new Date(body.currentUpdatedAt).getTime()).toBeGreaterThan(
      new Date(fixture.updatedAt).getTime(),
    );

    // The order is untouched by the losing write.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.id } });
    expect(order.orderStatus).toBe("APPROVED");
  });

  it("lets exactly one of two concurrent submissions win (no silent overwrite)", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-D`, status: "PENDING" });
    const payload = {
      action: "APPROVE" as const,
      reason: "Racing decision submitted simultaneously by two reviewers",
      expectedUpdatedAt: fixture.updatedAt,
    };
    const [a, b] = await Promise.all([makeRequest(fixture.id, payload), makeRequest(fixture.id, payload)]);
    // The losing submission is rejected server-side either as stale (409 —
    // it saw the pre-update row) or as an invalid transition (422 — it read
    // after the winner committed). Either way nothing is silently overwritten.
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.id } });
    expect(order.orderStatus).toBe("APPROVED");
    // Exactly one review + one audit row — the losing request wrote nothing.
    expect(await prisma.review.count({ where: { orderId: fixture.id } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: "ORDER", entityId: fixture.id, action: "REVIEW_STATUS_CHANGED" },
      }),
    ).toBe(1);
  });

  it("enforces the documented transition matrix server-side", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-E`, status: "PENDING" });
    // PENDING → PENDING (reset) is not allowed.
    const reset = await makeRequest(fixture.id, {
      action: "RESET_TO_PENDING",
      reason: "Attempting an unauthorized transition from pending",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(reset.status).toBe(422);

    // HOLD from PENDING is allowed; then APPROVE from HELD is allowed.
    const hold = await makeRequest(fixture.id, {
      action: "HOLD",
      reason: "Holding to request additional verification documents",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(hold.status).toBe(200);
    const afterHold = (await hold.json()) as { order: { updatedAt: string } };

    const approve = await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "Verification documents received and checked",
      expectedUpdatedAt: afterHold.order.updatedAt,
    });
    expect(approve.status).toBe(200);
    const afterApprove = (await approve.json()) as { order: { updatedAt: string } };

    // APPROVED → RESET_TO_PENDING allowed.
    const resetBack = await makeRequest(fixture.id, {
      action: "RESET_TO_PENDING",
      reason: "Reopening after new evidence arrived from the customer",
      expectedUpdatedAt: afterApprove.order.updatedAt,
    });
    expect(resetBack.status).toBe(200);
    const body = (await resetBack.json()) as { toStatus: string };
    expect(body.toStatus).toBe("PENDING");
  });

  it("requires a reason and rejects forged/unknown fields", async () => {
    const fixture = await createTestOrder({ number: `${TEST_PREFIX}WF-F`, status: "PENDING" });

    // Missing reason → 400.
    const noReason = await makeRequest(fixture.id, {
      action: "APPROVE",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(noReason.status).toBe(400);

    // Too-short reason → 400.
    const shortReason = await makeRequest(fixture.id, {
      action: "APPROVE",
      reason: "ok",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(shortReason.status).toBe(400);

    // Forged target status must be ignored (unknown key stripped by the schema):
    // the transition still follows the action + matrix, not the forged field.
    const forged = await makeRequest(fixture.id, {
      action: "APPROVE",
      status: "HELD_FOR_REVIEW",
      orderStatus: "APPROVED",
      reason: "Forged status fields must never reach the transition logic",
      expectedUpdatedAt: fixture.updatedAt,
    });
    expect(forged.status).toBe(200);
    const body = (await forged.json()) as { toStatus: string };
    expect(body.toStatus).toBe("APPROVED");

    // Malformed expectedUpdatedAt → 400.
    const badDate = await makeRequest(fixture.id, {
      action: "HOLD",
      reason: "Timestamp field is malformed in this forged request",
      expectedUpdatedAt: "not-a-date",
    });
    expect(badDate.status).toBe(400);
  });

  it("returns 404 for unknown orders", async () => {
    const res = await makeRequest("does-not-exist", {
      action: "APPROVE",
      reason: "Unknown order identifier probe",
      expectedUpdatedAt: "2026-10-27T00:00:00.000Z",
    });
    expect(res.status).toBe(404);
  });

  it("serves dashboard aggregates from stored engine snapshots", async () => {
    const res = await statsGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalOrders: number;
      pending: number;
      held: number;
      highRisk: number;
      avgRisk: number | null;
      trend: { day: string; orders: number; flagged: number }[];
    };
    expect(body.totalOrders).toBeGreaterThan(0);
    expect(body.avgRisk).not.toBeNull();
    expect(body.avgRisk ?? 0).toBeGreaterThanOrEqual(0);
    expect(body.avgRisk ?? 0).toBeLessThanOrEqual(100);
    for (const point of body.trend) {
      expect(point.flagged).toBeLessThanOrEqual(point.orders);
    }
  });
});
