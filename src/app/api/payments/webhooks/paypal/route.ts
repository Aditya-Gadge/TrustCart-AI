import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { getPayPalConfig, createPayPalTransport } from "@/lib/payments/paypal";
import { handlePaypalWebhook, WEBHOOK_MAX_BODY_BYTES } from "@/lib/payments/flow";
import { readLimitedBody } from "@/lib/payments/read-limited-body";

/**
 * POST /api/payments/webhooks/paypal — PayPal Sandbox webhooks (Phase 5).
 *
 * Every event is verified server-side via
 * /v1/notifications/verify-webhook-signature with PAYPAL_WEBHOOK_ID before
 * any state changes; unverified or unverifiable events are rejected (PayPal
 * retries). Verified events are applied idempotently and only move payment
 * state forward — this endpoint never invents payments and is a secondary
 * signal to the authoritative capture endpoint. Since Phase 6, a webhook
 * can NEVER mark a payment VERIFIED: the capture endpoint is the sole
 * verifier (webhook PAYMENT.CAPTURE.COMPLETED events are informational).
 */
export async function POST(request: NextRequest) {
  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "database_unconfigured" }, { status: 503 });
  }
  const config = getPayPalConfig();
  if (!config?.webhookId) {
    return NextResponse.json(
      { error: "webhook_unconfigured", message: "Set PAYPAL_WEBHOOK_ID server-side to enable webhooks" },
      { status: 503 },
    );
  }

  // Defensive size cap before reading/parsing (Phase 6).
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > WEBHOOK_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }

  let rawBody: string | null;
  try {
    rawBody = await readLimitedBody(request.body, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }
  if (rawBody === null) {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }
  const outcome = await handlePaypalWebhook(
    prisma,
    createPayPalTransport(config),
    config.webhookId,
    {
      transmissionId: request.headers.get("paypal-transmission-id"),
      transmissionTime: request.headers.get("paypal-transmission-time"),
      certUrl: request.headers.get("paypal-cert-url"),
      authAlgo: request.headers.get("paypal-auth-algo"),
      transmissionSig: request.headers.get("paypal-transmission-sig"),
    },
    rawBody,
  );

  if (outcome.handled) {
    return NextResponse.json(
      { received: true, action: outcome.action, eventType: outcome.eventType },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (outcome.code === "invalid_signature") {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  if (outcome.code === "malformed_payload") {
    return NextResponse.json({ error: "malformed_payload" }, { status: 400 });
  }
  if (outcome.code === "unconfigured") {
    return NextResponse.json({ error: "webhook_unconfigured" }, { status: 503 });
  }
  // unverifiable — tell PayPal to retry later.
  return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
}
