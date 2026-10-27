import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { getPayPalConfig, createPayPalTransport } from "@/lib/payments/paypal";
import { capturePaymentForOrder } from "@/lib/payments/flow";
import { capturePaymentSchema } from "@/lib/validation/payment-capture";
import { createRateLimiter, clientKeyFromHeaders } from "@/lib/ratelimit";

/**
 * POST /api/orders/:id/payments/capture — server-side capture (Phase 5).
 *
 * The browser's approval callback alone is never proof of captured payment:
 * this endpoint captures against the PayPal API, then verifies the returned
 * provider order id, capture status, amount, currency, and the association
 * with the intended application order before any VERIFIED state is written.
 * Repeated capture requests return the persisted state without new records.
 * Rate-limited per client key (Phase 6).
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
    return NextResponse.json({ error: "payments_unconfigured" }, { status: 503 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_payload", message: "Body must be JSON" },
      { status: 400 },
    );
  }
  const parsed = capturePaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: "A valid PayPal order reference is required" },
      { status: 400 },
    );
  }

  const outcome = await capturePaymentForOrder(
    prisma,
    createPayPalTransport(config),
    id,
    parsed.data.providerOrderId,
  );

  if (outcome.ok) {
    return NextResponse.json(
      { payment: outcome.payment },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (outcome.code === "invalid_reference") {
    // 404 without detail: the reference does not belong to this order.
    return NextResponse.json(
      { error: "invalid_reference", message: "This PayPal order does not belong to this application order" },
      { status: 404 },
    );
  }
  if (outcome.code === "capture_not_allowed") {
    return NextResponse.json(
      {
        error: "capture_not_allowed",
        paymentStatus: outcome.paymentStatus,
        message: "This payment attempt can no longer be captured. Start a new payment.",
      },
      { status: 422 },
    );
  }
  if (outcome.code === "capture_declined") {
    return NextResponse.json(
      { error: "capture_declined", message: "PayPal declined the capture. No payment was recorded as received." },
      { status: 402 },
    );
  }
  if (outcome.code === "amount_mismatch") {
    return NextResponse.json(
      {
        error: "amount_mismatch",
        expectedMinor: outcome.expectedMinor,
        actualMinor: outcome.actualMinor,
        actualCurrency: outcome.actualCurrency,
        currency: outcome.currency,
        message: "The captured amount did not match the application order. Recorded as failed.",
      },
      { status: 409 },
    );
  }
  if (outcome.code === "database_error") {
    return NextResponse.json({ error: "database_unreachable" }, { status: 503 });
  }
  // provider_error
  return NextResponse.json(
    {
      error: outcome.kind === "timeout" ? "provider_timeout" : "provider_unavailable",
      message:
        outcome.kind === "timeout"
          ? "PayPal did not respond in time. Retry safely — the capture is idempotent."
          : "PayPal is unavailable or rejected the request. Retry shortly.",
    },
    { status: outcome.kind === "timeout" || outcome.kind === "network" ? 503 : 502 },
  );
}
