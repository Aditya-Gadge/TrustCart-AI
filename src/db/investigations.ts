import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Investigation payload for the order-detail page (Phase 3): the order with
 * its current risk snapshot, full review history, any REAL payment records
 * (never fabricated — the seed writes none), and the audit timeline.
 */

export type InvestigationReason = {
  code: string;
  label: string;
  points: number;
  explanation: string;
  evidence?: { label: string; value: string }[];
};

export type InvestigationData = {
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    shippingCountry: string;
    amount: number;
    currency: string;
    itemCount: number;
    accountAgeDays: number;
    recentOrderCount: number;
    shippingMismatch: boolean;
    orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
    createdAt: Date;
    updatedAt: Date;
  };
  assessment: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    reasons: InvestigationReason[];
    rulesVersion: string;
    createdAt: Date;
  } | null;
  reviews: {
    id: string;
    reviewerId: string;
    decision: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
    note: string | null;
    createdAt: Date;
  }[];
  payments: {
    id: string;
    provider: string;
    providerOrderId: string | null;
    providerCaptureId: string | null;
    status: string;
    amount: number;
    currency: string;
    verifiedAt: Date | null;
    createdAt: Date;
  }[];
  auditEvents: {
    id: string;
    action: string;
    actor: string;
    metadata: unknown;
    createdAt: Date;
  }[];
};

export async function getInvestigation(
  prisma: PrismaClient,
  orderId: string,
): Promise<InvestigationData | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      shippingCountry: true,
      amount: true,
      currency: true,
      itemCount: true,
      accountAgeDays: true,
      recentOrderCount: true,
      shippingMismatch: true,
      orderStatus: true,
      createdAt: true,
      updatedAt: true,
      riskAssessment: {
        select: { score: true, level: true, reasons: true, rulesVersion: true, createdAt: true },
      },
      reviews: {
        select: { id: true, reviewerId: true, decision: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" as const },
      },
      payments: {
        select: {
          id: true,
          provider: true,
          providerOrderId: true,
          providerCaptureId: true,
          status: true,
          amount: true,
          currency: true,
          verifiedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" as const },
      },
    },
  });
  if (!order) return null;

  const { riskAssessment, ...rest } = order;

  const auditEvents = await prisma.auditEvent.findMany({
    where: { entityType: "ORDER", entityId: orderId },
    select: { id: true, action: true, actor: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 100,
  });

  return {
    order: rest,
    assessment: riskAssessment
      ? {
          score: riskAssessment.score,
          level: riskAssessment.level,
          reasons: riskAssessment.reasons as unknown as InvestigationReason[],
          rulesVersion: riskAssessment.rulesVersion,
          createdAt: riskAssessment.createdAt,
        }
      : null,
    reviews: order.reviews ?? [],
    payments: order.payments ?? [],
    auditEvents,
  };
}
