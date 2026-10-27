import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { getPayPalConfig, createPayPalTransport } from "@/lib/payments/paypal";
import { createPaymentForOrder } from "@/lib/payments/flow";
import { createRateLimiter, clientKeyFromHeaders } from "@/lib/ratelimit";

/**
 * POST /api/orders/:id/payments — create a PayPal order for an application
 * order (Phase 5). Server-computed amount/currency; returns ONLY the PayPal
 * order reference + payment id. 422 not_eligible for orders that are not
 * APPROVED; idempotent while a payment is active. Unconfigured credentials →
 * 503 payments_unconfigured. Rate-limited per client key (Phase 6).
 */

// Generous for real checkout usage; exists to throttle runaway abuse.
const limiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = limiter.check(clientKeyFromHeaders(request.headers.get("x-forwarded-for")));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "database_unconfigured" }, { status: 503 });
  }
  const config = getPayPalConfig();
  if (!config) {
    return NextResponse.json(
      { error: "payments_unconfigured", message: "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox) server-side" },
      { status: 503 },
    );
  }

  const { id } = await params;
  const outcome = await createPaymentForOrder(prisma, createPayPalTransport(config), id);

  if (outcome.ok) {
    return NextResponse.json(
      {
        paymentId: outcome.payment.id,
        providerOrderId: outcome.payment.providerOrderId,
        status: outcome.payment.status,
        amountMinor: outcome.payment.amountMinor,
        currency: outcome.payment.currency,
        reused: outcome.reused,
      },
      { status: outcome.reused ? 200 : 201, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (outcome.code === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (outcome.code === "not_eligible") {
    return NextResponse.json(
      { error: "not_eligible", orderStatus: outcome.orderStatus },
      { status: 422 },
    );
  }
  if (outcome.code === "database_error") {
    return NextResponse.json({ error: "database_unreachable" }, { status: 503 });
  }
  // provider_error — user-safe, secret-free.
  return NextResponse.json(
    {
      error: outcome.kind === "timeout" ? "provider_timeout" : "provider_unavailable",
      message:
        outcome.kind === "timeout"
          ? "PayPal did not respond in time. The payment attempt can be retried safely."
          : "PayPal is unavailable or rejected the request. Try again shortly.",
    },
    { status: outcome.kind === "timeout" || outcome.kind === "network" ? 503 : 502 },
  );
}
