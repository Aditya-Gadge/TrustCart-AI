import { assessOrder, type RiskAssessmentResult } from "@/lib/risk/engine";
import {
  DEMO_REVIEWER,
  REVIEW_DECISION,
  TARGET_STATUS,
  isTransitionAllowed,
  type OrderStatusKey,
  type ReviewAction,
} from "@/lib/review/transitions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Review workflow data service (Phase 3).
 *
 * All authorization-relevant rules are enforced here, server-side,
 * independent of client state:
 * - the transition matrix (invalid transitions are rejected, never guessed),
 * - optimistic concurrency: the write only lands when the order's
 *   `updatedAt` still matches what the reviewer saw; otherwise the update is
 *   rejected as `stale_write` instead of silently overwriting a concurrent
 *   decision,
 * - the reviewer identity (fixed demo actor — clients cannot claim one),
 * - a fresh deterministic risk snapshot persisted alongside the decision,
 * - an audit event recording actor, from/to status, and the reason.
 *
 * Everything happens in ONE interactive transaction so a decision and its
 * audit trail are all-or-nothing.
 */

export type ReviewOutcome =
  | {
      ok: true;
      order: { id: string; orderNumber: string; orderStatus: OrderStatusKey; updatedAt: Date };
      fromStatus: OrderStatusKey;
      toStatus: OrderStatusKey;
      reviewId: string;
      assessment: RiskAssessmentResult;
    }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid_transition"; fromStatus: OrderStatusKey }
  | { ok: false; code: "stale_write"; currentUpdatedAt: string };

type OrderWithFeatures = {
  id: string;
  orderNumber: string;
  amount: number;
  currency: string;
  accountAgeDays: number;
  recentOrderCount: number;
  shippingMismatch: boolean;
  createdAt: Date;
  orderStatus: OrderStatusKey;
  updatedAt: Date;
};

function toAssessmentInput(order: OrderWithFeatures) {
  return {
    amountMinor: order.amount,
    currency: order.currency,
    accountAgeDays: order.accountAgeDays,
    recentOrderCount: order.recentOrderCount,
    shippingMismatch: order.shippingMismatch,
    placedAt: order.createdAt,
  };
}

export async function applyReviewAction(
  prisma: PrismaClient,
  orderId: string,
  action: ReviewAction,
  reason: string,
  expectedUpdatedAt: Date,
): Promise<ReviewOutcome> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        amount: true,
        currency: true,
        accountAgeDays: true,
        recentOrderCount: true,
        shippingMismatch: true,
        createdAt: true,
        orderStatus: true,
        updatedAt: true,
      },
    });
    if (!order) return { ok: false as const, code: "not_found" as const };

    const fromStatus = order.orderStatus;
    if (!isTransitionAllowed(fromStatus, action)) {
      return { ok: false as const, code: "invalid_transition" as const, fromStatus };
    }

    // Optimistic concurrency check against what the reviewer actually saw.
    if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      return {
        ok: false as const,
        code: "stale_write" as const,
        currentUpdatedAt: order.updatedAt.toISOString(),
      };
    }

    // Conditional write: even under a concurrent race the WHERE clause only
    // matches the unchanged row, so exactly one of two racing decisions wins.
    const guard = await tx.order.updateMany({
      where: { id: orderId, updatedAt: expectedUpdatedAt },
      data: { orderStatus: TARGET_STATUS[action] },
    });
    if (guard.count !== 1) {
      return {
        ok: false as const,
        code: "stale_write" as const,
        currentUpdatedAt: order.updatedAt.toISOString(),
      };
    }

    // Re-run the deterministic engine on the order's own features and
    // persist the fresh snapshot (snapshots are stored on recalculation).
    const assessment = assessOrder(toAssessmentInput(order));
    await tx.riskAssessment.upsert({
      where: { orderId },
      create: {
        orderId,
        score: assessment.score,
        level: assessment.level,
        reasons: assessment.reasons,
        rulesVersion: assessment.rulesVersion,
      },
      update: {
        score: assessment.score,
        level: assessment.level,
        reasons: assessment.reasons,
        rulesVersion: assessment.rulesVersion,
      },
    });

    const review = await tx.review.create({
      data: {
        orderId,
        reviewerId: DEMO_REVIEWER,
        decision: REVIEW_DECISION[action],
        note: reason,
      },
    });

    await tx.auditEvent.create({
      data: {
        entityType: "ORDER",
        entityId: orderId,
        action: "REVIEW_STATUS_CHANGED",
        actor: DEMO_REVIEWER,
        metadata: {
          fromStatus,
          toStatus: TARGET_STATUS[action],
          reviewAction: action,
          reason,
          reviewId: review.id,
          rulesVersion: assessment.rulesVersion,
        },
      },
    });

    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, orderNumber: true, orderStatus: true, updatedAt: true },
    });

    return {
      ok: true as const,
      order: fresh,
      fromStatus,
      toStatus: TARGET_STATUS[action],
      reviewId: review.id,
      assessment,
    };
  });
}
