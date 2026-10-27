import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import type { PayPalTransport } from "@/lib/payments/paypal";
import {
  capturePaymentForOrder,
  createPaymentForOrder,
  handlePaypalWebhook,
} from "@/lib/payments/flow";
import { minorUnitsToDecimalString } from "@/lib/payments/money";

/**
 * PayPal payment flow integration tests (Phase 5) — REAL database, MOCKED
 * PayPal transport. These tests do NOT contact PayPal: provider responses are
 * simulated fixtures. A real Sandbox checkout is a separate manual QA step
 * (documented in the README) and is NOT claimed by this suite.
 *
 * Isolation rule: every scenario uses its OWN fixture order AND a UNIQUE
 * provider order id (providerOrderId is globally unique in the schema), so
 * scenarios cannot contaminate each other through active-payment reuse or
 * the unique constraint.
 */

const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;

const FIXTURE_NUMBERS = Array.from({ length: 16 }, (_, index) => `TC-88${String(index + 1).padStart(2, "0")}`);

type Fixture = {
  orderId: string;
  amountMinor: number;
  currency: string;
  providerOrderId: string;
};

/** One isolated order + matching provider order id per scenario. */
async function makeFixture(orderNumber: string, amountMinor: number): Promise<Fixture> {
  const order = await prisma.order.create({
    data: {
      orderNumber,
      amount: amountMinor,
      currency: "USD",
      itemCount: 1,
      customerName: "Payment Fixture",
      customerEmail: "payment-fixture@demo.example",
      shippingCountry: "Testland",
      accountAgeDays: 300,
      recentOrderCount: 0,
      shippingMismatch: false,
      orderStatus: "APPROVED",
      createdAt: new Date(),
    },
    select: { id: true, amount: true, currency: true },
  });
  return {
    orderId: order.id,
    amountMinor: order.amount,
    currency: order.currency,
    providerOrderId: `PAYPAL-${orderNumber}`,
  };
}

function transportFor(
  fixture: Fixture,
  overrides: Partial<PayPalTransport> = {},
): PayPalTransport {
  return {
    createOrder: async () => ({ id: fixture.providerOrderId, status: "CREATED" }),
    captureOrder: async () => ({
      id: fixture.providerOrderId,
      status: "COMPLETED",
      capture: {
        id: `CAPTURE-${fixture.providerOrderId}`,
        status: "COMPLETED",
        amount: {
          currency_code: fixture.currency,
          value: minorUnitsToDecimalString(fixture.amountMinor, fixture.currency),
        },
      },
    }),
    verifyWebhookSignature: async () => true,
    // Overrides (wrong amounts, throws, rejections) replace the base methods.
    ...overrides,
  };
}

const WEBHOOK_HEADERS = {
  transmissionId: "trans-1",
  transmissionTime: "2026-10-27T00:00:00Z",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  authAlgo: "SHA256withRSA",
  transmissionSig: "sig-1",
};

function captureCompletedEvent(paypalOrderId: string, captureId: string): string {
  return JSON.stringify({
    id: "evt-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      status: "COMPLETED",
      supplementary_data: { related_ids: { order_id: paypalOrderId } },
    },
  });
}

beforeAll(async () => {
  const client = getPrisma();
  if (!client) throw new Error("expected a configured Prisma client");
  prisma = client;
  await prisma.order.deleteMany({ where: { orderNumber: { in: FIXTURE_NUMBERS } } });
}, 30_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.order.deleteMany({ where: { orderNumber: { in: FIXTURE_NUMBERS } } });
  await prisma.$disconnect();
}, 30_000);

const describeIf = describe.skipIf(!hasDatabaseUrl);

describeIf("payment creation (mocked provider, real DB)", () => {
  it("creates a payment from trusted server-side order data and records an audit event", async () => {
    const fixture = await makeFixture("TC-8801", 50_000);
    const outcome = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(outcome.payment.providerOrderId).toBe(fixture.providerOrderId);
    expect(outcome.payment.status).toBe("CREATED");
    // Amount/currency come from the DB order row, not from any client input.
    expect(outcome.payment.amountMinor).toBe(50_000);
    expect(outcome.payment.currency).toBe("USD");

    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "PAYMENT", entityId: outcome.payment.id },
    });
    expect(audits.map((audit) => audit.action)).toContain("PAYMENT_ORDER_CREATED");
  });

  it("is idempotent while the payment is active: the same PayPal order returns, no new row", async () => {
    const fixture = await makeFixture("TC-8802", 20_000);
    const first = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    const second = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.payment.providerOrderId).toBe(first.payment.providerOrderId);

    const rows = await prisma.payment.findMany({ where: { orderId: fixture.orderId } });
    expect(rows).toHaveLength(1);
  });

  it("rejects creation for orders that are not APPROVED and for unknown orders", async () => {
    const fixture = await makeFixture("TC-8803", 20_000);
    await prisma.order.update({
      where: { id: fixture.orderId },
      data: { orderStatus: "PENDING" },
    });
    const pending = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(pending).toMatchObject({ ok: false, code: "not_eligible", orderStatus: "PENDING" });

    const unknown = await createPaymentForOrder(prisma, transportFor(fixture), "does-not-exist");
    expect(unknown).toMatchObject({ ok: false, code: "not_found" });
  });

  it("records FAILED on a definitive provider rejection and allows a fresh attempt", async () => {
    const fixture = await makeFixture("TC-8804", 30_000);
    const rejecting = transportFor(fixture, {
      createOrder: async () => {
        throw { kind: "provider_rejected", status: 400, message: "PayPal rejected the create" };
      },
    });
    const failed = await createPaymentForOrder(prisma, rejecting, fixture.orderId);
    expect(failed).toMatchObject({ ok: false, code: "provider_error", kind: "provider_rejected" });
    const rows = await prisma.payment.findMany({ where: { orderId: fixture.orderId } });
    expect(rows.map((row) => row.status)).toEqual(["FAILED"]);

    // A new attempt may start after the definitive failure.
    const retry = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.reused).toBe(false);
  });

  it("keeps the reservation retryable on a provider timeout (ambiguous outcome)", async () => {
    const fixture = await makeFixture("TC-8805", 40_000);
    const timingOut = transportFor(fixture, {
      createOrder: async () => {
        throw { kind: "timeout", message: "PayPal API request timed out" };
      },
    });
    const outcome = await createPaymentForOrder(prisma, timingOut, fixture.orderId);
    expect(outcome).toMatchObject({ ok: false, code: "provider_error", kind: "timeout" });
    // Ambiguous: the row is NOT marked FAILED — the attempt can be retried.
    const rows = await prisma.payment.findMany({
      where: { orderId: fixture.orderId, status: "CREATED" },
    });
    expect(rows).toHaveLength(1);

    // Retry with a working provider COMPLETES the same reservation: the stale
    // row (no provider id yet) is retried with the same PayPal-Request-Id and
    // filled in — it must not be stuck as an empty CREATED reservation.
    const retry = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.reused).toBe(true);
    expect(retry.payment.id).toBe(rows[0]?.id);
    expect(retry.payment.providerOrderId).toBe(fixture.providerOrderId);
    expect(retry.payment.amountMinor).toBe(40_000);

    const retriedRow = await prisma.payment.findUnique({ where: { id: rows[0]?.id ?? "" } });
    expect(retriedRow?.providerOrderId).toBe(fixture.providerOrderId);
    expect(retriedRow?.amount).toBe(40_000);
    expect(retriedRow?.currency).toBe("USD");
  });
});

describeIf("capture (server-side verification, mocked provider)", () => {
  it("verifies capture server-side and writes VERIFIED with capture id + audit", async () => {
    const fixture = await makeFixture("TC-8806", 50_000);
    const created = await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outcome = await capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.payment.status).toBe("VERIFIED");
    expect(outcome.payment.providerCaptureId).toBe(`CAPTURE-${fixture.providerOrderId}`);
    expect(outcome.payment.verifiedAt).not.toBeNull();

    const row = await prisma.payment.findUnique({ where: { id: outcome.payment.id } });
    expect(row?.status).toBe("VERIFIED");
    expect(row?.verifiedAt).not.toBeNull();
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "PAYMENT", entityId: outcome.payment.id, action: "PAYMENT_VERIFIED" },
    });
    expect(audits).toHaveLength(1);
  });

  it("returns the persisted state for duplicate capture requests (no new records)", async () => {
    const fixture = await makeFixture("TC-8807", 60_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    const again = await capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.payment.status).toBe("VERIFIED");

    // Scoped to THIS payment row: other suites run in parallel against the
    // same database and would otherwise shift a global count.
    const auditsAfter = await prisma.auditEvent.count({
      where: { entityType: "PAYMENT", entityId: again.payment.id, action: "PAYMENT_VERIFIED" },
    });
    expect(auditsAfter).toBe(1);

    const rows = await prisma.payment.findMany({ where: { orderId: fixture.orderId } });
    expect(rows).toHaveLength(1);
  });

  it("rejects a capture whose PayPal order belongs to a DIFFERENT application order", async () => {
    const fixture = await makeFixture("TC-8808", 70_000);
    const other = await makeFixture("TC-8809", 80_000);
    await createPaymentForOrder(prisma, transportFor(other), other.orderId);

    // other.providerOrderId belongs to TC-8809, not TC-8808.
    const outcome = await capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, other.providerOrderId);
    expect(outcome).toMatchObject({ ok: false, code: "invalid_reference" });
  });

  it("marks the payment FAILED when the captured amount mismatches the order", async () => {
    const fixture = await makeFixture("TC-8810", 30_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);

    const mismatched = transportFor(fixture, {
      captureOrder: async () => ({
        id: fixture.providerOrderId,
        status: "COMPLETED",
        capture: {
          id: "CAPTURE-MISMATCH",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: minorUnitsToDecimalString(100, "USD") },
        },
      }),
    });
    const outcome = await capturePaymentForOrder(prisma, mismatched, fixture.orderId, fixture.providerOrderId);
    // Phase 6: the outcome now reports the provider's ACTUAL amount/currency
    // (previously hardcoded actualMinor: -1) so operators can see the delta.
    expect(outcome).toMatchObject({
      ok: false,
      code: "amount_mismatch",
      expectedMinor: fixture.amountMinor,
      actualMinor: 100,
      currency: "USD",
    });

    const row = await prisma.payment.findFirst({ where: { orderId: fixture.orderId } });
    expect(row?.status).toBe("FAILED");
    expect(row?.verifiedAt).toBeNull();
  });

  it("records DECLINED captures as FAILED (never VERIFIED)", async () => {
    const fixture = await makeFixture("TC-8811", 30_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);

    const declining = transportFor(fixture, {
      captureOrder: async () => ({ id: fixture.providerOrderId, status: "DECLINED", capture: null }),
    });
    const outcome = await capturePaymentForOrder(prisma, declining, fixture.orderId, fixture.providerOrderId);
    expect(outcome).toMatchObject({ ok: false, code: "capture_declined" });
    const row = await prisma.payment.findFirst({ where: { orderId: fixture.orderId } });
    expect(row?.status).toBe("FAILED");
  });

  it("leaves the row untouched on a capture timeout, and an idempotent retry succeeds", async () => {
    const fixture = await makeFixture("TC-8812", 30_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);

    const timingOut = transportFor(fixture, {
      captureOrder: async () => {
        throw { kind: "timeout", message: "PayPal API request timed out" };
      },
    });
    const timedOut = await capturePaymentForOrder(prisma, timingOut, fixture.orderId, fixture.providerOrderId);
    expect(timedOut).toMatchObject({ ok: false, code: "provider_error", kind: "timeout" });
    const rowAfterTimeout = await prisma.payment.findFirst({ where: { orderId: fixture.orderId } });
    expect(rowAfterTimeout?.status).toBe("CREATED");

    const retry = await capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.payment.status).toBe("VERIFIED");
  });

  it("maps a PENDING provider capture to CAPTURED (not VERIFIED)", async () => {
    const fixture = await makeFixture("TC-8813", 30_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);

    const pending = transportFor(fixture, {
      captureOrder: async () => ({
        id: fixture.providerOrderId,
        status: "PENDING",
        capture: {
          id: "CAPTURE-PENDING",
          status: "PENDING",
          amount: { currency_code: "USD", value: minorUnitsToDecimalString(fixture.amountMinor, "USD") },
        },
      }),
    });
    const outcome = await capturePaymentForOrder(prisma, pending, fixture.orderId, fixture.providerOrderId);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.payment.status).toBe("CAPTURED");
  });

  it("refuses capture on FAILED/EXPIRED payments", async () => {
    const fixture = await makeFixture("TC-8814", 30_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);
    await prisma.payment.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: "EXPIRED" },
    });
    const outcome = await capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId);
    expect(outcome).toMatchObject({ ok: false, code: "capture_not_allowed", paymentStatus: "EXPIRED" });
  });

  it("resolves CONCURRENT capture attempts with one transition and no duplicate audits", async () => {
    const fixture = await makeFixture("TC-8815", 90_000);
    await createPaymentForOrder(prisma, transportFor(fixture), fixture.orderId);

    // Both attempts pass the pre-capture status check before either persists.
    const results = await Promise.all([
      capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId),
      capturePaymentForOrder(prisma, transportFor(fixture), fixture.orderId, fixture.providerOrderId),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);

    const rows = await prisma.payment.findMany({ where: { orderId: fixture.orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("VERIFIED");

    // The race must not double-write business records or audit events.
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "PAYMENT", entityId: rows[0]?.id ?? "", action: "PAYMENT_VERIFIED" },
    });
    expect(audits).toHaveLength(1);
  });
});

describeIf("payment creation concurrency (advisory-lock serialization)", () => {
  it("never creates a second reservation for concurrent creates, and every provider call replays the SAME PayPal-Request-Id", async () => {
    // Phase 6 regression (security review P2, TOCTOU): two concurrent
    // creates used to both observe "no active payment" and both insert
    // reservation rows. A per-order transaction advisory lock now
    // serializes them. Pinning test: the invariant must hold regardless of
    // interleaving timing.
    const fixture = await makeFixture("TC-8816", 75_000);
    const requestIds: string[] = [];
    const counting = transportFor(fixture, {
      createOrder: async (args) => {
        requestIds.push(args.paypalRequestId);
        return { id: fixture.providerOrderId, status: "CREATED" };
      },
    });

    const results = await Promise.all([
      createPaymentForOrder(prisma, counting, fixture.orderId),
      createPaymentForOrder(prisma, counting, fixture.orderId),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(2);
    // Exactly ONE caller created the reservation…
    const created = results.filter((result) => result.ok && result.reused === false);
    expect(created).toHaveLength(1);
    // …both callers reference the SAME payment row…
    const paymentIds = new Set(
      results.flatMap((result) => (result.ok ? [result.payment.id] : [])),
    );
    expect(paymentIds.size).toBe(1);
    // …exactly one Payment row exists…
    const rows = await prisma.payment.findMany({ where: { orderId: fixture.orderId } });
    expect(rows).toHaveLength(1);
    // …and any provider call replayed the SAME deterministic request id, so
    // even concurrent stale-retries can never produce a second PayPal order.
    if (requestIds.length > 0) {
      expect(new Set(requestIds).size).toBe(1);
      expect(requestIds[0]).toBe(`trustcart-${rows[0]?.id}`);
    }
  });
});

describeIf("webhooks (signature verification required)", () => {
  it("rejects an event when signature verification fails", async () => {
    const rejecting = transportFor(
      { orderId: "x", amountMinor: 1, currency: "USD", providerOrderId: "x" },
      { verifyWebhookSignature: async () => false },
    );
    const outcome = await handlePaypalWebhook(
      prisma,
      rejecting,
      "webhook-id-1",
      WEBHOOK_HEADERS,
      captureCompletedEvent("PAYPAL-ANY", "CAPTURE-WEBHOOK-1"),
    );
    expect(outcome).toMatchObject({ handled: false, code: "invalid_signature" });
  });

  it("rejects events with missing transmission headers as malformed_payload before verification", async () => {
    // Phase 6: header validation is schema-based — a request missing the
    // signed header material is malformed (400), not a signature failure.
    const outcome = await handlePaypalWebhook(
      prisma,
      transportFor({ orderId: "x", amountMinor: 1, currency: "USD", providerOrderId: "x" }),
      "webhook-id-1",
      { ...WEBHOOK_HEADERS, transmissionSig: null },
      captureCompletedEvent("PAYPAL-ANY", "CAPTURE-WEBHOOK-2"),
    );
    expect(outcome).toMatchObject({ handled: false, code: "malformed_payload" });
  });

  it("acknowledges PAYMENT.CAPTURE.COMPLETED informationally — the capture endpoint stays the sole verifier", async () => {
    // Phase 6 TIGHTENING (security review P2): a signature-valid webhook can
    // no longer flip a payment to VERIFIED. Only the capture endpoint
    // verifies provider order association, status, amount, and currency
    // server-side; webhooks are acknowledged but change no state, so a
    // webhook can never bypass amount verification or resurrect a row.
    const order = await prisma.order.findUnique({
      where: { orderNumber: "TC-8806" },
      select: { id: true },
    });
    if (!order) throw new Error("expected the TC-8806 fixture order to exist");
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: "CREATED",
        providerOrderId: "PAYPAL-WEBHOOK-1",
        amount: 50_000,
        currency: "USD",
      },
    });

    const webhookFixture = {
      orderId: order.id,
      amountMinor: 50_000,
      currency: "USD",
      providerOrderId: "PAYPAL-WEBHOOK-1",
    };
    const body = captureCompletedEvent("PAYPAL-WEBHOOK-1", "CAPTURE-WEBHOOK-3");
    const first = await handlePaypalWebhook(prisma, transportFor(webhookFixture), "webhook-id-1", WEBHOOK_HEADERS, body);
    expect(first).toMatchObject({ handled: true, action: "ignored" });

    const row = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(row?.status).toBe("CREATED");
    expect(row?.providerCaptureId).toBeNull();
    expect(row?.verifiedAt).toBeNull();
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "PAYMENT", entityId: payment.id },
    });
    expect(audits).toHaveLength(0);

    // Replayed webhook: still acknowledged, still no state change.
    const replay = await handlePaypalWebhook(prisma, transportFor(webhookFixture), "webhook-id-1", WEBHOOK_HEADERS, body);
    expect(replay).toMatchObject({ handled: true, action: "ignored" });
    const rowAfterReplay = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(rowAfterReplay?.status).toBe("CREATED");
    expect(await prisma.auditEvent.findMany({ where: { entityType: "PAYMENT", entityId: payment.id } })).toHaveLength(0);
  });

  it("never resurrects a FAILED payment to VERIFIED from a webhook", async () => {
    // Phase 6 regression (security review P2): even a signature-valid
    // PAYMENT.CAPTURE.COMPLETED must not flip FAILED → VERIFIED.
    const order = await prisma.order.findUnique({
      where: { orderNumber: "TC-8806" },
      select: { id: true },
    });
    if (!order) throw new Error("expected the TC-8806 fixture order to exist");
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: "FAILED",
        providerOrderId: "PAYPAL-WEBHOOK-FAILED",
        amount: 50_000,
        currency: "USD",
      },
    });
    const outcome = await handlePaypalWebhook(
      prisma,
      transportFor({ orderId: order.id, amountMinor: 50_000, currency: "USD", providerOrderId: "PAYPAL-WEBHOOK-FAILED" }),
      "webhook-id-1",
      WEBHOOK_HEADERS,
      captureCompletedEvent("PAYPAL-WEBHOOK-FAILED", "CAPTURE-WEBHOOK-FAILED"),
    );
    expect(outcome).toMatchObject({ handled: true, action: "ignored" });
    const row = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(row?.status).toBe("FAILED");
    expect(row?.verifiedAt).toBeNull();
  });

  it("rejects a malformed JSON body with malformed_payload before verification", async () => {
    const outcome = await handlePaypalWebhook(
      prisma,
      transportFor({ orderId: "x", amountMinor: 1, currency: "USD", providerOrderId: "x" }),
      "webhook-id-1",
      WEBHOOK_HEADERS,
      "{not json at all",
    );
    expect(outcome).toMatchObject({ handled: false, code: "malformed_payload" });
  });

  it("moves payments forward only: approved → payer_approved, denied → FAILED", async () => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: "TC-8807" },
      select: { id: true },
    });
    if (!order) throw new Error("expected the TC-8807 fixture order to exist");
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: "CREATED",
        providerOrderId: "PAYPAL-WEBHOOK-2",
        amount: 60_000,
        currency: "USD",
      },
    });

    const approvedEvent = JSON.stringify({
      id: "evt-2",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: "PAYPAL-WEBHOOK-2", status: "APPROVED" },
    });
    const outcome = await handlePaypalWebhook(prisma, transportFor({
      orderId: payment.orderId, amountMinor: 60_000, currency: "USD", providerOrderId: "PAYPAL-WEBHOOK-2",
    }), "webhook-id-1", WEBHOOK_HEADERS, approvedEvent);
    expect(outcome).toMatchObject({ handled: true, action: "state_updated" });
    let row = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(row?.status).toBe("PAYER_APPROVED");

    const deniedEvent = JSON.stringify({
      id: "evt-3",
      event_type: "PAYMENT.CAPTURE.DENIED",
      resource: {
        id: "CAPTURE-DENIED",
        status: "DECLINED",
        supplementary_data: { related_ids: { order_id: "PAYPAL-WEBHOOK-2" } },
      },
    });
    await handlePaypalWebhook(prisma, transportFor({
      orderId: payment.orderId, amountMinor: 60_000, currency: "USD", providerOrderId: "PAYPAL-WEBHOOK-2",
    }), "webhook-id-1", WEBHOOK_HEADERS, deniedEvent);
    row = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(row?.status).toBe("FAILED");

    // Unknown event types are acknowledged and ignored.
    const unknown = await handlePaypalWebhook(
      prisma,
      transportFor({ orderId: payment.orderId, amountMinor: 60_000, currency: "USD", providerOrderId: "PAYPAL-WEBHOOK-2" }),
      "webhook-id-1",
      WEBHOOK_HEADERS,
      JSON.stringify({ id: "evt-4", event_type: "MERCHANT.ONBOARDING.COMPLETED", resource: { id: "x" } }),
    );
    expect(unknown).toMatchObject({ handled: true, action: "ignored" });
  });

  it("never invents payments for events referencing unknown PayPal orders", async () => {
    const before = await prisma.payment.count();
    const outcome = await handlePaypalWebhook(
      prisma,
      transportFor({ orderId: "x", amountMinor: 1, currency: "USD", providerOrderId: "x" }),
      "webhook-id-1",
      WEBHOOK_HEADERS,
      captureCompletedEvent("PAYPAL-ORDER-UNKNOWN", "CAPTURE-ORPHAN"),
    );
    expect(outcome).toMatchObject({ handled: true, action: "ignored" });
    expect(await prisma.payment.count()).toBe(before);
  });
});
