import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";
import type { PayPalTransport } from "@/lib/payments/paypal";

/**
 * Route-level tests for the payment endpoints (Phase 5): HTTP status mapping
 * with a MOCKED PayPal transport + mocked config. Database is real. These are
 * not real Sandbox checkouts — provider responses are simulated fixtures.
 */

const mocks = vi.hoisted(() => ({
  transport: null as PayPalTransport | null,
  configured: true,
  webhookId: "test-webhook-id-123" as string | null,
}));

vi.mock("@/lib/payments/paypal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/payments/paypal")>();
  return {
    ...original,
    getPayPalConfig: () =>
      mocks.configured
        ? {
            clientId: "test-client-id-1234567890",
            baseUrl: original.PAYPAL_SANDBOX_BASE_URL,
            webhookId: mocks.webhookId ?? undefined,
            clientSecret: "test-client-secret-1234567890",
          }
        : null,
    createPayPalTransport: () =>
      mocks.transport ??
      ({
        createOrder: async () => ({ id: "PAYPAL-ROUTE-1", status: "CREATED" }),
        captureOrder: async () => ({
          id: "PAYPAL-ROUTE-1",
          status: "COMPLETED",
          capture: {
            id: "CAPTURE-ROUTE-1",
            status: "COMPLETED",
            // Fixture orders are 50_000 minor units = "500.00".
            amount: { currency_code: "USD", value: "500.00" },
          },
        }),
        verifyWebhookSignature: async () => true,
      } satisfies PayPalTransport),
  };
});

const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;
let approvedOrderId: string;
let mismatchOrderId: string;
let timeoutOrderId: string;
let forgedOrderId: string;

async function makeFixtureOrder(orderNumber: string): Promise<string> {
  const order = await prisma.order.create({
    data: {
      orderNumber,
      amount: 50_000,
      currency: "USD",
      itemCount: 1,
      customerName: "Payment Route Fixture",
      customerEmail: "payment-route@demo.example",
      shippingCountry: "Testland",
      accountAgeDays: 300,
      recentOrderCount: 0,
      shippingMismatch: false,
      orderStatus: "APPROVED",
      createdAt: new Date(),
    },
  });
  return order.id;
}

async function post(url: string, body: unknown): Promise<Response> {
  const mod = await import(
    url.endsWith("/capture")
      ? "@/app/api/orders/[id]/payments/capture/route"
      : url.includes("webhooks")
        ? "@/app/api/payments/webhooks/paypal/route"
        : "@/app/api/orders/[id]/payments/route"
  );
  const request = new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const id = url.split("/")[3] ?? "";
  return mod.POST(request, { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  const client = getPrisma();
  if (!client) throw new Error("expected a configured Prisma client");
  prisma = client;
  // Fixture numbers are DISJOINT from payments-flow.spec.ts — the two
  // integration files run in parallel against one database.
  await prisma.order.deleteMany({
    where: { orderNumber: { in: ["TC-8901", "TC-8902", "TC-8903", "TC-8904"] } },
  });
  approvedOrderId = await makeFixtureOrder("TC-8901");
  mismatchOrderId = await makeFixtureOrder("TC-8902");
  timeoutOrderId = await makeFixtureOrder("TC-8903");
  forgedOrderId = await makeFixtureOrder("TC-8904");
}, 30_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.order.deleteMany({
    where: { orderNumber: { in: ["TC-8901", "TC-8902", "TC-8903", "TC-8904"] } },
  });
  await prisma.$disconnect();
}, 30_000);

async function postWebhook(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/payments/webhooks/paypal/route");
  const request = new NextRequest("http://localhost:3000/api/payments/webhooks/paypal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "paypal-transmission-id": "trans-1",
      "paypal-transmission-time": "2026-10-27T00:00:00Z",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "sig-1",
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const describeIf = describe.skipIf(!hasDatabaseUrl);

describeIf("POST /api/orders/:id/payments route", () => {
  it("returns 201 with ONLY the PayPal order reference (no secrets, no client data)", async () => {
    const res = await post(`/api/orders/${approvedOrderId}/payments`, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.providerOrderId).toBe("PAYPAL-ROUTE-1");
    expect(body.amountMinor).toBe(50_000);
    expect(body.currency).toBe("USD");
    expect(JSON.stringify(body)).not.toContain("secret");
    // Repeated request: 200 with the same reference (idempotent).
    const again = await post(`/api/orders/${approvedOrderId}/payments`, {});
    expect(again.status).toBe(200);
  });

  it("returns 422 not_eligible for a non-APPROVED order and 404 for unknown ids", async () => {
    await prisma.order.update({
      where: { id: approvedOrderId },
      data: { orderStatus: "PENDING" },
    });
    const ineligible = await post(`/api/orders/${approvedOrderId}/payments`, {});
    expect(ineligible.status).toBe(422);
    await prisma.order.update({
      where: { id: approvedOrderId },
      data: { orderStatus: "APPROVED" },
    });
    const unknown = await post("/api/orders/nope/payments", {});
    expect(unknown.status).toBe(404);
  });

  it("returns 503 payments_unconfigured without credentials", async () => {
    mocks.configured = false;
    const res = await post(`/api/orders/${approvedOrderId}/payments`, {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("payments_unconfigured");
    mocks.configured = true;
  });
});

describeIf("POST /api/orders/:id/payments/capture route", () => {
  it("rejects malformed bodies with 400 and unknown references with 404", async () => {
    const bad = await post(`/api/orders/${approvedOrderId}/payments/capture`, { providerOrderId: "DROP TABLE" });
    expect(bad.status).toBe(400);
    const missing = await post(`/api/orders/${approvedOrderId}/payments/capture`, {});
    expect(missing.status).toBe(400);
    const unknown = await post(`/api/orders/${approvedOrderId}/payments/capture`, {
      providerOrderId: "PAYPAL-UNKNOWN-REF",
    });
    expect(unknown.status).toBe(404);
  });

  it("maps a verified capture to 200 and an amount mismatch to 409", async () => {
    const res = await post(`/api/orders/${approvedOrderId}/payments/capture`, {
      providerOrderId: "PAYPAL-ROUTE-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payment: { status: string } };
    expect(body.payment.status).toBe("VERIFIED");

    // Fresh fixture order so `create` reserves a NEW PayPal order (the active
    // VERIFIED payment on TC-8901 would otherwise be reused).
    mocks.transport = {
      createOrder: async () => ({ id: "PAYPAL-ROUTE-2", status: "CREATED" }),
      captureOrder: async () => ({
        id: "PAYPAL-ROUTE-2",
        status: "COMPLETED",
        capture: {
          id: "CAPTURE-BAD",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "1.00" },
        },
      }),
      verifyWebhookSignature: async () => true,
    };
    const created = await post(`/api/orders/${mismatchOrderId}/payments`, {});
    expect(created.status).toBe(201);
    const mismatch = await post(`/api/orders/${mismatchOrderId}/payments/capture`, {
      providerOrderId: "PAYPAL-ROUTE-2",
    });
    expect(mismatch.status).toBe(409);
    const mismatchBody = (await mismatch.json()) as { error: string };
    expect(mismatchBody.error).toBe("amount_mismatch");
    mocks.transport = null;
  });

  it("maps a provider timeout to 503 provider_timeout with a retry-safe message", async () => {
    mocks.transport = {
      createOrder: async () => ({ id: "PAYPAL-ROUTE-3", status: "CREATED" }),
      captureOrder: async () => {
        throw { kind: "timeout", message: "PayPal API request timed out" };
      },
      verifyWebhookSignature: async () => true,
    };
    const created = await post(`/api/orders/${timeoutOrderId}/payments`, {});
    expect(created.status).toBe(201);
    const res = await post(`/api/orders/${timeoutOrderId}/payments/capture`, {
      providerOrderId: "PAYPAL-ROUTE-3",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("provider_timeout");
    mocks.transport = null;
  });

  it("ignores forged success fields: a forged capture body behaves identically to a clean one", async () => {
    mocks.transport = {
      createOrder: async () => ({ id: "PAYPAL-ROUTE-4", status: "CREATED" }),
      captureOrder: async () => ({
        id: "PAYPAL-ROUTE-4",
        status: "COMPLETED",
        capture: {
          id: "CAPTURE-ROUTE-4",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "500.00" },
        },
      }),
      verifyWebhookSignature: async () => true,
    };
    const created = await post(`/api/orders/${forgedOrderId}/payments`, {});
    expect(created.status).toBe(201);

    // The client forges every success-looking field the schema never reads:
    // Zod strips unknown keys, so none of these can influence the outcome.
    // If the forged amount were honoured, server-side verification against
    // the DB row would 409 amount_mismatch instead of 200.
    const forged = await post(`/api/orders/${forgedOrderId}/payments/capture`, {
      providerOrderId: "PAYPAL-ROUTE-4",
      status: "COMPLETED",
      verified: true,
      paymentId: "attacker-controlled",
      amount: { value: "0.01", currency_code: "USD" },
    });
    expect(forged.status).toBe(200);
    const body = (await forged.json()) as {
      payment: { status: string; amountMinor: number; currency: string; providerCaptureId: string | null };
    };
    expect(body.payment.status).toBe("VERIFIED");
    // Amount/currency come from the trusted DB order row, not the body.
    expect(body.payment.amountMinor).toBe(50_000);
    expect(body.payment.currency).toBe("USD");
    expect(body.payment.providerCaptureId).toBe("CAPTURE-ROUTE-4");

    // No forged field leaked into the persisted business record.
    const row = await prisma.payment.findFirst({ where: { orderId: forgedOrderId } });
    expect(row?.status).toBe("VERIFIED");
    expect(row?.amount).toBe(50_000);
    expect(row?.currency).toBe("USD");
    expect(row?.providerCaptureId).toBe("CAPTURE-ROUTE-4");

    mocks.transport = null;
  });
});

describeIf("POST /api/payments/webhooks/paypal route", () => {
  it("rejects an invalid webhook signature with 400 before any state change", async () => {
    mocks.transport = {
      createOrder: async () => ({ id: "x", status: "CREATED" }),
      captureOrder: async () => ({
        id: "x",
        status: "COMPLETED",
        capture: null,
      }),
      verifyWebhookSignature: async () => false,
    };
    const res = await postWebhook({ id: "evt", event_type: "PAYMENT.CAPTURE.COMPLETED" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");
    mocks.transport = null;
  });

  it("returns 503 webhook_unconfigured when no webhook id is set", async () => {
    mocks.webhookId = null;
    const res = await postWebhook({ id: "evt", event_type: "PAYMENT.CAPTURE.COMPLETED" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("webhook_unconfigured");
    mocks.webhookId = "test-webhook-id-123";
  });

  it("acknowledges a verified webhook with 200", async () => {
    const res = await postWebhook({
      id: "evt-route-1",
      event_type: "MERCHANT.ONBOARDING.COMPLETED",
      resource: { id: "x" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; action: string };
    expect(body.received).toBe(true);
    expect(body.action).toBe("ignored");
  });
});
