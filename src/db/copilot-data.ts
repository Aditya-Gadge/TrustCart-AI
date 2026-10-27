import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Read-only data access for the merchant copilot (Phase 4).
 *
 * The model NEVER writes SQL and NEVER receives raw table access: these are
 * the ONLY queries the copilot can reach, they are fixed and parameterized,
 * every field is whitelisted, and every result set is capped. Authorization:
 * this demo has a single server-side merchant (D-002) — the executor in
 * src/lib/ai/tools.ts is the only caller, so tool invocation is already
 * past server-side validation by construction.
 */

export type CopilotOrderContext = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shippingCountry: string;
  amountMinor: number;
  currency: string;
  itemCount: number;
  accountAgeDays: number;
  recentOrderCount: number;
  shippingMismatch: boolean;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAtIso: string;
  risk: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    rulesVersion: string;
    reasons: { code: string; label: string; points: number; explanation: string }[];
  } | null;
  reviews: { decision: string; createdAtIso: string; note: string | null }[];
  payments: { status: string; currency: string; amountMinor: number; verified: boolean }[];
};

export async function getCopilotOrderContext(
  prisma: PrismaClient,
  identifier: { orderId: string } | { orderNumber: string },
): Promise<CopilotOrderContext | null> {
  const order = await prisma.order.findFirst({
    where: "orderId" in identifier ? { id: identifier.orderId } : { orderNumber: identifier.orderNumber },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      shippingCountry: true,
      amount: true,
      currency: true,
      itemCount: true,
      accountAgeDays: true,
      recentOrderCount: true,
      shippingMismatch: true,
      orderStatus: true,
      createdAt: true,
      riskAssessment: {
        select: { score: true, level: true, rulesVersion: true, reasons: true },
      },
      reviews: {
        select: { decision: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" as const },
        take: 5,
      },
      payments: {
        select: { status: true, currency: true, amount: true, verifiedAt: true },
        orderBy: { createdAt: "desc" as const },
        take: 5,
      },
    },
  });
  if (!order) return null;

  const { riskAssessment, ...rest } = order;
  return {
    orderId: rest.id,
    orderNumber: rest.orderNumber,
    customerName: rest.customerName,
    shippingCountry: rest.shippingCountry,
    amountMinor: rest.amount,
    currency: rest.currency,
    itemCount: rest.itemCount,
    accountAgeDays: rest.accountAgeDays,
    recentOrderCount: rest.recentOrderCount,
    shippingMismatch: rest.shippingMismatch,
    orderStatus: rest.orderStatus,
    createdAtIso: rest.createdAt.toISOString(),
    risk: riskAssessment
      ? {
          score: riskAssessment.score,
          level: riskAssessment.level,
          rulesVersion: riskAssessment.rulesVersion,
          reasons: (riskAssessment.reasons as {
            code: string;
            label: string;
            points: number;
            explanation: string;
          }[]) ?? [],
        }
      : null,
    reviews: order.reviews.map((r) => ({
      decision: r.decision,
      createdAtIso: r.createdAt.toISOString(),
      note: r.note,
    })),
    payments: order.payments.map((p) => ({
      status: p.status,
      currency: p.currency,
      amountMinor: p.amount,
      verified: p.verifiedAt !== null,
    })),
  };
}

export type CopilotOrderRow = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shippingCountry: string;
  amountMinor: number;
  currency: string;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAtIso: string;
  riskScore: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
};

export type CopilotOrderFilters = {
  status?: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  band?: "LOW" | "MEDIUM" | "HIGH";
  minAmountMinor?: number;
  createdSince?: Date;
  q?: string;
  sort: "newest" | "oldest" | "amount_high" | "risk_high";
  limit: number;
};

const COPILOT_SORTS = {
  newest: [{ createdAt: "desc" as const }, { id: "asc" as const }],
  oldest: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  amount_high: [{ amount: "desc" as const }, { id: "asc" as const }],
  risk_high: [{ riskAssessment: { score: "desc" as const } }, { id: "asc" as const }],
} as const;
export async function listCopilotOrders(
  prisma: PrismaClient,
  filters: CopilotOrderFilters,
): Promise<CopilotOrderRow[]> {
  const rows = await prisma.order.findMany({
    where: {
      ...(filters.status ? { orderStatus: filters.status } : {}),
      ...(filters.band ? { riskAssessment: { level: filters.band } } : {}),
      ...(filters.minAmountMinor !== undefined ? { amount: { gte: filters.minAmountMinor } } : {}),
      ...(filters.createdSince ? { createdAt: { gte: filters.createdSince } } : {}),
      ...(filters.q
        ? {
            OR: [
              { orderNumber: { contains: filters.q, mode: "insensitive" as const } },
              { customerName: { contains: filters.q, mode: "insensitive" as const } },
              { shippingCountry: { contains: filters.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [...COPILOT_SORTS[filters.sort]],
    take: filters.limit,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      shippingCountry: true,
      amount: true,
      currency: true,
      orderStatus: true,
      createdAt: true,
      riskAssessment: { select: { score: true, level: true } },
    },
  });
  return rows.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    shippingCountry: o.shippingCountry,
    amountMinor: o.amount,
    currency: o.currency,
    orderStatus: o.orderStatus,
    createdAtIso: o.createdAt.toISOString(),
    riskScore: o.riskAssessment?.score ?? null,
    riskLevel: o.riskAssessment?.level ?? null,
  }));
}

export type RiskSignalCount = {
  code: string;
  /** Human label is attached by the tool layer (REASON_META lookup). */
  label?: string;
  orders: number;
};

/** Frequency of each risk reason code across stored engine snapshots. */
export async function getRiskSignalCounts(
  prisma: PrismaClient,
  limit: number,
): Promise<{ totalAssessments: number; signals: RiskSignalCount[] }> {
  const assessments = await prisma.riskAssessment.findMany({
    select: { reasons: true },
  });
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    const reasons = (assessment.reasons as { code: string }[]) ?? [];
    for (const reason of reasons) {
      counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
    }
  }
  const signals = [...counts.entries()]
    .map(([code, orders]) => ({ code, orders }))
    .sort((a, b) => b.orders - a.orders || a.code.localeCompare(b.code))
    .slice(0, limit);
  return {
    totalAssessments: assessments.length,
    signals,
  };
}
