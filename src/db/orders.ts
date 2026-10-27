import type { PrismaClient } from "@/generated/prisma/client";
import type { OrderQuery } from "@/lib/validation/order-query";

/**
 * Data access for paginated order retrieval. Authoritative filtering —
 * clients only ever send validated query parameters, never fragments of
 * SQL or raw predicates.
 */

export type OrderListRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  shippingCountry: string;
  amount: number;
  currency: string;
  itemCount: number;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAt: Date;
  risk: { score: number; level: "LOW" | "MEDIUM" | "HIGH" } | null;
};

export type OrderListResult = {
  items: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const SORTS = {
  newest: { createdAt: "desc" as const },
  oldest: { createdAt: "asc" as const },
  amount_high: { amount: "desc" as const },
  amount_low: { amount: "asc" as const },
  // Nested one-to-one ordering by the joined RiskAssessment.
  risk_high: { riskAssessment: { score: "desc" as const } },
  risk_low: { riskAssessment: { score: "asc" as const } },
} as const;

export async function listOrders(
  prisma: PrismaClient,
  query: OrderQuery,
): Promise<OrderListResult> {
  const where = {
    ...(query.status === "ALL"
      ? {}
      : { orderStatus: query.status }),
    ...(query.band === "ALL"
      ? {}
      : { riskAssessment: { level: query.band } }),
    ...(query.q === ""
      ? {}
      : {
          OR: [
            { orderNumber: { contains: query.q, mode: "insensitive" as const } },
            { customerName: { contains: query.q, mode: "insensitive" as const } },
            { customerEmail: { contains: query.q, mode: "insensitive" as const } },
            { shippingCountry: { contains: query.q, mode: "insensitive" as const } },
          ],
        }),
  };

  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [SORTS[query.sort], { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        shippingCountry: true,
        amount: true,
        currency: true,
        itemCount: true,
        orderStatus: true,
        createdAt: true,
        riskAssessment: { select: { score: true, level: true } },
      },
    }),
  ]);

  return {
    items: items.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      shippingCountry: o.shippingCountry,
      amount: o.amount,
      currency: o.currency,
      itemCount: o.itemCount,
      orderStatus: o.orderStatus,
      createdAt: o.createdAt,
      risk: o.riskAssessment
        ? { score: o.riskAssessment.score, level: o.riskAssessment.level }
        : null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
