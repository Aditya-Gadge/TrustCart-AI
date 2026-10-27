import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  isPayPalError,
  type PayPalCaptureResult,
  type PayPalTransport,
} from "@/lib/payments/paypal";
import { minorUnitsToDecimalString, decimalStringToMinorUnits } from "@/lib/payments/money";

/**
 * Server-side PayPal payment flow (Phase 5) — the ONLY code path that writes
 * Payment rows or payment audit events.
 *
 * Security model:
 * - Amount and currency come from the trusted application Order row (integer
 *   minor units). Nothing amount-related is ever accepted from the browser.
 * - A browser approval callback is treated as nothing: VERIFIED is written
 *   only after the server calls PayPal capture and checks the returned
 *   provider order id, capture status, capture amount, currency, and the
 *   association with the intended application order.
 * - Idempotency: Payment rows are created BEFORE the provider call with a
 *   deterministic PayPal-Request-Id (`trustcart-{paymentId}` / `trustcart-
 *   capture-{paymentId}`), so provider-side retries replay the same result;
 *   DB-side, unique providerOrderId/providerCaptureId and forward-only
 *   status transitions prevent duplicate business records. Active payments
 *   short-circuit create instead of producing a second PayPal order.
 * - Ambiguous failures (timeout/network) leave the row untouched — capture
 *   may have succeeded provider-side, and a retry resolves it idempotently.
 * - Audit events record only safe, non-secret metadata.
 */

const ACTIVE_STATUSES = ["CREATED", "PAYER_APPROVED", "CAPTURED", "VERIFIED"] as const;

export type CreatePaymentOutcome =
  | {
      ok: true;
      reused: boolean;
      payment: {
        id: string;
        providerOrderId: string | null;
        status: "CREATED" | "PAYER_APPROVED" | "CAPTURED" | "VERIFIED";
        amountMinor: number;
        currency: string;
      };
    }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_eligible"; orderStatus: string }
  | { ok: false; code: "provider_error"; kind: "timeout" | "network" | "provider_rejected" | "invalid_response" }
  | { ok: false; code: "database_error" };

export type CapturePaymentOutcome =
  | {
      ok: true;
      payment: {
        id: string;
        providerOrderId: string | null;
        providerCaptureId: string | null;
        status: string;
        amountMinor: number;
        currency: string;
        verifiedAt: string | null;
      };
    }
  | { ok: false; code: "invalid_reference" }
  | { ok: false; code: "capture_not_allowed"; paymentStatus: string }
  | { ok: false; code: "capture_declined" }
  | { ok: false; code: "amount_mismatch"; expectedMinor: number; actualMinor: number; actualCurrency: string; currency: string }
  | { ok: false; code: "provider_error"; kind: "timeout" | "network" | "provider_rejected" | "invalid_response" }
  | { ok: false; code: "database_error" };

async function writePaymentAudit(
  prisma: PrismaClient,
  orderId: string,
  paymentId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      entityType: "PAYMENT",
      entityId: paymentId,
      action,
      actor: "paypal-sandbox",
      metadata: { orderId, paymentId, ...metadata },
    },
  });
}

function isProviderDefinitiveRejection(kind: "timeout" | "network" | "provider_rejected" | "invalid_response"): boolean {
  // Definitive provider rejections let us record FAILED honestly; ambiguous
  // failures (timeout/network/malformed) must leave the row untouched.
  return kind === "provider_rejected";
}

/**
 * POST /api/orders/:id/payments — create a PayPal order for an application
 * order. Returns the PayPal order reference ONLY (plus our own payment id
 * and amount display data); the client secret and token never leave here.
 */
export async function createPaymentForOrder(
  prisma: PrismaClient,
  transport: PayPalTransport,
  orderId: string,
): Promise<CreatePaymentOutcome> {
  // Reserve the business record first: unique row, deterministic request id.
  type Reservation =
    | { kind: "missing" }
    | { kind: "not_eligible"; orderStatus: string }
    | { kind: "reserved"; id: string; created: boolean };

  let reservation: Reservation | null = null;
  try {
    reservation = await prisma.$transaction(async (tx): Promise<Reservation> => {
      // Serialize per order (Phase 6): without a lock, two concurrent creates
      // can both observe "no active payment" and both insert reservations
      // (TOCTOU), then both call PayPal. The transaction-scoped advisory lock
      // makes the check-then-insert atomic per order.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderStatus: true },
      });
      if (!order) return { kind: "missing" };
      if (order.orderStatus !== "APPROVED") {
        return { kind: "not_eligible", orderStatus: order.orderStatus };
      }
      const active = await tx.payment.findFirst({
        where: { orderId, status: { in: [...ACTIVE_STATUSES] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, providerOrderId: true },
      });
      if (active) {
        // Idempotent: never create a second PayPal order while one is active.
        return { kind: "reserved", id: active.id, created: false };
      }
      const payment = await tx.payment.create({
        // Reservation placeholder: real amount/currency are written from the
        // trusted order row once the provider accepts the PayPal order.
        // "XXX" is the ISO-4217 "no currency" code (column is VarChar(3)).
        data: { orderId, status: "CREATED", amount: 0, currency: "XXX" },
        select: { id: true },
      });
      return { kind: "reserved", id: payment.id, created: true };
    });
  } catch (error) {
    console.error(
      "[payments:create] database error:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, code: "database_error" };
  }

  if (reservation === null || reservation.kind === "missing") {
    return { ok: false, code: "not_found" };
  }
  if (reservation.kind === "not_eligible") {
    return { ok: false, code: "not_eligible", orderStatus: reservation.orderStatus };
  }
  let reused = !reservation.created;
  if (!reservation.created) {
    // Active payment exists — return its persisted state, UNLESS it is a stale
    // reservation (CREATED with no provider order id, e.g. a create that timed
    // out before PayPal answered). A stale reservation retries the provider
    // call with the SAME deterministic PayPal-Request-Id (`trustcart-{id}`):
    // PayPal replays idempotently, so even if the original attempt landed
    // server-side, no duplicate PayPal order can result.
    const existing = await prisma.payment.findUnique({
      where: { id: reservation.id },
      select: {
        id: true,
        providerOrderId: true,
        status: true,
        amount: true,
        currency: true,
      },
    });
    if (!existing) return { ok: false, code: "database_error" };
    if (existing.providerOrderId !== null) {
      return {
        ok: true,
        reused: true,
        payment: {
          id: existing.id,
          providerOrderId: existing.providerOrderId,
          status: existing.status as "CREATED" | "PAYER_APPROVED" | "CAPTURED" | "VERIFIED",
          amountMinor: existing.amount,
          currency: existing.currency,
        },
      };
    }
    reused = true;
  }

  // New reservation or stale-retry: load trusted order data, then create the
  // PayPal order.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, amount: true, currency: true },
  });
  if (!order) return { ok: false, code: "not_found" };

  let amountValue: string;
  try {
    amountValue = minorUnitsToDecimalString(order.amount, order.currency);
  } catch (error) {
    await prisma.payment.update({
      where: { id: reservation.id },
      data: { status: "FAILED" },
    });
    await writePaymentAudit(prisma, orderId, reservation.id, "PAYMENT_CREATE_FAILED", {
      reason: error instanceof Error ? error.message : "unsupported currency",
    });
    return { ok: false, code: "provider_error", kind: "invalid_response" };
  }

  try {
    const created = await transport.createOrder({
      paypalRequestId: `trustcart-${reservation.id}`,
      amountValue,
      currencyCode: order.currency,
      referenceId: order.id,
      orderNumber: order.orderNumber,
    });
    const payment = await prisma.payment.update({
      where: { id: reservation.id },
      data: {
        providerOrderId: created.id,
        amount: order.amount,
        currency: order.currency,
      },
      select: { id: true, providerOrderId: true, status: true, amount: true, currency: true },
    });
    await writePaymentAudit(prisma, orderId, payment.id, "PAYMENT_ORDER_CREATED", {
      providerOrderId: created.id,
      amountValue,
      currency: order.currency,
    });
    return {
      ok: true,
      reused,
      payment: {
        id: payment.id,
        providerOrderId: payment.providerOrderId,
        status: payment.status as "CREATED",
        amountMinor: payment.amount,
        currency: payment.currency,
      },
    };
  } catch (error) {
    if (!isPayPalError(error)) {
      return { ok: false, code: "provider_error", kind: "invalid_response" };
    }
    if (isProviderDefinitiveRejection(error.kind)) {
      await prisma.payment.update({ where: { id: reservation.id }, data: { status: "FAILED" } });
      await writePaymentAudit(prisma, orderId, reservation.id, "PAYMENT_CREATE_FAILED", {
        reason: error.message,
      });
    } else {
      // Ambiguous: keep the reservation CREATED (retryable, same request id).
      await writePaymentAudit(prisma, orderId, reservation.id, "PAYMENT_CREATE_TIMEOUT", {
        reason: error.message,
      });
    }
    return { ok: false, code: "provider_error", kind: error.kind };
  }
}

/**
 * Verify the capture response against the trusted application order:
 * provider order id association, matching order/capture statuses, capture
 * amount, and currency. COMPLETED (money confirmed) and PENDING (capture
 * initiated, provider-side pending) map to VERIFIED / CAPTURED respectively.
 */
export function verifyCaptureAgainstOrder(
  captureResult: PayPalCaptureResult,
  providerOrderId: string,
  expectedAmountMinor: number,
  expectedCurrency: string,
):
  | { ok: true; captureId: string | null }
  | { ok: false; reason: string; actualMinor?: number; actualCurrency?: string } {
  // The provider must confirm the SAME PayPal order we asked to capture.
  if (captureResult.id !== providerOrderId) {
    return { ok: false, reason: "provider_order_id_mismatch" };
  }
  const capture = captureResult.capture;
  if (captureResult.status !== "COMPLETED" && captureResult.status !== "PENDING") {
    return { ok: false, reason: `capture_status_${captureResult.status.toLowerCase()}` };
  }
  if (capture) {
    if (capture.status !== captureResult.status) {
      return { ok: false, reason: "capture_status_mismatch" };
    }
    if (capture.amount === null) return { ok: false, reason: "capture_amount_missing" };
    const actualMinor = decimalStringToMinorUnits(capture.amount.value, capture.amount.currency_code);
    if (capture.amount.currency_code !== expectedCurrency || actualMinor !== expectedAmountMinor) {
      // Report the provider's ACTUAL amount/currency so the 409 response and
      // audit trail show the real delta (never a hardcoded sentinel).
      return {
        ok: false,
        reason: "amount_mismatch",
        actualMinor,
        actualCurrency: capture.amount.currency_code,
      };
    }
    return { ok: true, captureId: capture.id };
  }
  if (captureResult.status === "COMPLETED") {
    return { ok: false, reason: "capture_record_missing" };
  }
  // PENDING without a capture record yet — provider accepted, details later.
  return { ok: true, captureId: null };
}

/**
 * POST /api/orders/:id/payments/capture — server-side capture for an approved
 * PayPal order. The browser "approve" event alone NEVER marks money received.
 */
export async function capturePaymentForOrder(
  prisma: PrismaClient,
  transport: PayPalTransport,
  orderId: string,
  providerOrderId: string,
): Promise<CapturePaymentOutcome> {
  let payment;
  try {
    payment = await prisma.payment.findUnique({
      where: { providerOrderId },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        currency: true,
        providerCaptureId: true,
        verifiedAt: true,
      },
    });
  } catch (error) {
    console.error(
      "[payments:capture] database error:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, code: "database_error" };
  }

  // Association + ownership: the PayPal order must belong to THIS app order.
  if (!payment || payment.orderId !== orderId) {
    return { ok: false, code: "invalid_reference" };
  }
  if (payment.status === "VERIFIED" || payment.status === "CAPTURED") {
    // Idempotent replay: report current state without new records.
    return {
      ok: true,
      payment: {
        id: payment.id,
        providerOrderId,
        providerCaptureId: payment.providerCaptureId,
        status: payment.status,
        amountMinor: payment.amount,
        currency: payment.currency,
        verifiedAt: payment.verifiedAt?.toISOString() ?? null,
      },
    };
  }
  if (payment.status === "FAILED" || payment.status === "EXPIRED") {
    return { ok: false, code: "capture_not_allowed", paymentStatus: payment.status };
  }

  try {
    const result = await transport.captureOrder({
      providerOrderId,
      paypalRequestId: `trustcart-capture-${payment.id}`,
    });
    const verification = verifyCaptureAgainstOrder(result, providerOrderId, payment.amount, payment.currency);

    if (verification.ok && result.status === "COMPLETED") {
      // Guarded transition: with concurrent captures, exactly ONE request
      // performs the state change and writes the audit event.
      const guarded = await prisma.payment.updateMany({
        where: { id: payment.id, status: { notIn: ["VERIFIED", "CAPTURED"] } },
        data: {
          status: "VERIFIED",
          providerCaptureId: verification.captureId,
          verifiedAt: new Date(),
        },
      });
      const updated = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { providerCaptureId: true, verifiedAt: true },
      });
      if (guarded.count === 1) {
        await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_VERIFIED", {
          providerCaptureId: verification.captureId,
          amountMinor: payment.amount,
          currency: payment.currency,
        });
      }
      return {
        ok: true,
        payment: {
          id: payment.id,
          providerOrderId,
          providerCaptureId: updated.providerCaptureId,
          status: "VERIFIED",
          amountMinor: payment.amount,
          currency: payment.currency,
          verifiedAt: (updated.verifiedAt ?? new Date()).toISOString(),
        },
      };
    }

    if (verification.ok && result.status === "PENDING") {
      // Capture initiated but not completed provider-side (e.g. eCheck).
      const guarded = await prisma.payment.updateMany({
        where: { id: payment.id, status: { notIn: ["VERIFIED", "CAPTURED"] } },
        data: { status: "CAPTURED" },
      });
      const updated = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { verifiedAt: true },
      });
      if (guarded.count === 1) {
        await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_CAPTURE_PENDING", {
          providerStatus: result.status,
        });
      }
      return {
        ok: true,
        payment: {
          id: payment.id,
          providerOrderId,
          providerCaptureId: null,
          status: "CAPTURED",
          amountMinor: payment.amount,
          currency: payment.currency,
          verifiedAt: updated.verifiedAt?.toISOString() ?? null,
        },
      };
    }

    // Record the failure honestly (never VERIFIED), classified by reason.
    // The guard prevents a concurrent VERIFIED winner from being clobbered.
    const failed = await prisma.payment.updateMany({
      where: { id: payment.id, status: { notIn: ["VERIFIED", "CAPTURED"] } },
      data: { status: "FAILED" },
    });
    if (failed.count === 1) {
      await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_CAPTURE_FAILED", {
        reason: verification.ok ? `provider_status_${result.status.toLowerCase()}` : verification.reason,
        providerStatus: result.status,
        ...(verification.ok || verification.actualMinor === undefined
          ? {}
          : {
              expectedMinor: payment.amount,
              actualMinor: verification.actualMinor,
              actualCurrency: verification.actualCurrency ?? null,
            }),
      });
    }
    if (!verification.ok && verification.reason === "amount_mismatch") {
      return {
        ok: false,
        code: "amount_mismatch",
        expectedMinor: payment.amount,
        actualMinor: verification.actualMinor ?? -1,
        actualCurrency: verification.actualCurrency ?? payment.currency,
        currency: payment.currency,
      };
    }
    if (!verification.ok && verification.reason === "capture_status_declined") {
      return { ok: false, code: "capture_declined" };
    }
    // Integrity-level anomalies (wrong provider order id, missing capture
    // record/amount, unexpected provider statuses) are provider failures.
    return { ok: false, code: "provider_error", kind: "invalid_response" };
  } catch (error) {
    if (!isPayPalError(error)) {
      return { ok: false, code: "provider_error", kind: "invalid_response" };
    }
    if (isProviderDefinitiveRejection(error.kind)) {
      // A definitive provider rejection of the CAPTURE call (e.g. order
      // already voided) is safe to record as FAILED.
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_CAPTURE_FAILED", {
        reason: error.message,
      });
    } else {
      // Ambiguous (timeout/network): the row stays as-is; retry resolves
      // idempotently because the PayPal-Request-Id is deterministic.
      await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_CAPTURE_TIMEOUT", {
        reason: error.message,
      });
    }
    return { ok: false, code: "provider_error", kind: error.kind };
  }
}

// ── Webhooks (optional PAYPAL_WEBHOOK_ID) ────────────────────────────────

export type WebhookOutcome =
  | { handled: true; action: "verified" | "state_updated" | "ignored"; eventType: string }
  | {
      handled: false;
      code: "unconfigured" | "invalid_signature" | "unverifiable" | "malformed_payload";
    };

type PaypalWebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

/** Header material required for /verify-webhook-signature. */
const webhookHeadersSchema = z.object({
  transmissionId: z.string().min(1).max(128),
  transmissionTime: z.string().min(1).max(64),
  certUrl: z.string().min(1).max(512),
  authAlgo: z.string().min(1).max(128),
  transmissionSig: z.string().min(1).max(1024),
});

/** Event envelope: only the fields this handler reads, unknown keys ignored. */
const webhookEventSchema = z.looseObject({
  id: z.string().max(128).optional(),
  event_type: z.string().max(128).optional(),
  resource: z
    .looseObject({
      id: z.string().max(256).optional(),
      status: z.string().max(64).optional(),
      supplementary_data: z
        .looseObject({
          related_ids: z
            .looseObject({ order_id: z.string().max(256).optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Defensive body cap before parsing (PayPal events are small JSON). */
export const WEBHOOK_MAX_BODY_BYTES = 128 * 1024;

/**
 * Apply a signature-VERIFIED webhook event idempotently. Webhooks are a
 * convenience signal ONLY — the capture endpoint is the authoritative
 * verifier (it checks provider order association, capture status, amount,
 * and currency server-side). VERIFIED is therefore NEVER written from a
 * webhook: PAYMENT.CAPTURE.COMPLETED is acknowledged and ignored, so a
 * webhook can never bypass amount verification or resurrect a FAILED row.
 * Forward-only state moves remain: CREATED → PAYER_APPROVED (checkout
 * approved) and → FAILED (capture denied), never backwards.
 */
export async function handlePaypalWebhook(
  prisma: PrismaClient,
  transport: PayPalTransport,
  webhookId: string,
  headers: {
    transmissionId: string | null;
    transmissionTime: string | null;
    certUrl: string | null;
    authAlgo: string | null;
    transmissionSig: string | null;
  },
  rawBody: string,
): Promise<WebhookOutcome> {
  // Schema-validate header material and the event envelope BEFORE signature
  // verification; malformed requests are rejected without touching PayPal.
  const headerParse = webhookHeadersSchema.safeParse(headers);
  if (!headerParse.success) {
    return { handled: false, code: "malformed_payload" };
  }
  if (rawBody.length > WEBHOOK_MAX_BODY_BYTES) {
    return { handled: false, code: "malformed_payload" };
  }
  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(rawBody);
  } catch {
    return { handled: false, code: "malformed_payload" };
  }
  const eventParse = webhookEventSchema.safeParse(rawEvent);
  if (!eventParse.success) {
    return { handled: false, code: "malformed_payload" };
  }
  const event = eventParse.data as PaypalWebhookEvent;

  let verified: boolean;
  try {
    verified = await transport.verifyWebhookSignature({
      transmissionId: headerParse.data.transmissionId,
      transmissionTime: headerParse.data.transmissionTime,
      certUrl: headerParse.data.certUrl,
      authAlgo: headerParse.data.authAlgo,
      transmissionSig: headerParse.data.transmissionSig,
      webhookId,
      webhookEvent: event as unknown as Record<string, unknown>,
    });
  } catch {
    // Verification service unreachable — never trust the event.
    return { handled: false, code: "unverifiable" };
  }
  if (!verified) return { handled: false, code: "invalid_signature" };

  const eventType = event.event_type ?? "";
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
  const resourceId = event.resource?.id ?? null;

  const findPayment = async () => {
    if (orderId) {
      const byOrder = await prisma.payment.findFirst({
        where: { providerOrderId: orderId },
        orderBy: { createdAt: "desc" },
      });
      if (byOrder) return byOrder;
    }
    if (resourceId && eventType.startsWith("CHECKOUT.")) {
      return prisma.payment.findFirst({ where: { providerOrderId: resourceId }, orderBy: { createdAt: "desc" } });
    }
    return null;
  };

  try {
    if (eventType === "CHECKOUT.ORDER.APPROVED") {
      const payment = await findPayment();
      if (!payment || payment.status !== "CREATED") {
        return { handled: true, action: payment ? "state_updated" : "ignored", eventType };
      }
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "PAYER_APPROVED" } });
      await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_PAYER_APPROVED", {
        providerOrderId: payment.providerOrderId,
      });
      return { handled: true, action: "state_updated", eventType };
    }

    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      // Informational only (Phase 6 tightening): money movement is confirmed
      // exclusively by the capture endpoint's server-side verification.
      // Never mark VERIFIED from a webhook — a signature-valid event could
      // otherwise bypass amount/currency checks or resurrect FAILED rows.
      return { handled: true, action: "ignored", eventType };
    }

    if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "PAYMENT.CAPTURE.DECLINED") {
      const payment = await findPayment();
      if (!payment || payment.status === "VERIFIED" || payment.status === "FAILED") {
        return { handled: true, action: payment ? "state_updated" : "ignored", eventType };
      }
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      await writePaymentAudit(prisma, payment.orderId, payment.id, "PAYMENT_CAPTURE_FAILED", {
        reason: "webhook_denied",
        providerCaptureId: resourceId,
      });
      return { handled: true, action: "state_updated", eventType };
    }

    return { handled: true, action: "ignored", eventType };
  } catch (error) {
    console.error(
      "[payments:webhook] database error:",
      error instanceof Error ? error.message : error,
    );
    return { handled: false, code: "unverifiable" };
  }
}
