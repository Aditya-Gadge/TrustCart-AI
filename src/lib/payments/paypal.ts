import "server-only";
import { z } from "zod";

/**
 * Server-only PayPal Sandbox integration (Phase 5).
 *
 * - REST API v2 (Orders) + OAuth2 client credentials + webhook signature
 *   verification via /v1/notifications/verify-webhook-signature — current
 *   documented endpoints (verified against the official PayPal Developer
 *   docs, October 2026).
 * - SANDBOX ONLY: the base URL is pinned to api-m.sandbox.paypal.com and the
 *   config parser refuses a live host outright.
 * - The client secret never leaves this module: `server-only` guard, no
 *   logging of credentials, no echoing in any response payload.
 * - All provider traffic goes through the `PayPalTransport` interface so
 *   automated tests inject deterministic mocked responses (clearly
 *   distinguished from a real Sandbox checkout).
 */

const paypalEnvSchema = z.object({
  clientId: z.string().trim().min(20, "PAYPAL_CLIENT_ID looks too short"),
  clientSecret: z.string().trim().min(20, "PAYPAL_CLIENT_SECRET looks too short"),
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine(
      (value) => value === "https://api-m.sandbox.paypal.com",
      { message: "Only the Sandbox API host is supported in this demo" },
    ),
  webhookId: z.string().trim().min(10).optional(),
});

export type PayPalConfig = z.infer<typeof paypalEnvSchema>;

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

/** Validated config, or null when payments are not configured (app still boots). */
export function getPayPalConfig(): PayPalConfig | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (clientId === undefined || clientId === "" || clientSecret === undefined || clientSecret === "") {
    return null;
  }
  const parsed = paypalEnvSchema.safeParse({
    clientId,
    clientSecret,
    baseUrl: process.env.PAYPAL_BASE_URL ?? PAYPAL_SANDBOX_BASE_URL,
    webhookId: process.env.PAYPAL_WEBHOOK_ID || undefined,
  });
  return parsed.success ? parsed.data : null;
}

// ── Transport shapes (mock-friendly) ─────────────────────────────────────

export type PayPalOrderCreated = {
  id: string;
  status: string;
};

export type PayPalCaptureResult = {
  id: string;
  status: string;
  /** purchase_units[0].payments.captures[0] when present. */
  capture: {
    id: string;
    status: string;
    amount: { currency_code: string; value: string } | null;
  } | null;
};

export type CreateOrderArgs = {
  /** Idempotency: stable across retries of the same logical attempt. */
  paypalRequestId: string;
  amountValue: string; // decimal string, e.g. "1434.81"
  currencyCode: string;
  referenceId: string; // application order id
  orderNumber: string;
};

export type CaptureOrderArgs = {
  providerOrderId: string;
  paypalRequestId: string;
};

export type VerifyWebhookArgs = {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
  webhookId: string;
  webhookEvent: Record<string, unknown>;
};

export type PayPalTransport = {
  createOrder: (args: CreateOrderArgs) => Promise<PayPalOrderCreated>;
  captureOrder: (args: CaptureOrderArgs) => Promise<PayPalCaptureResult>;
  verifyWebhookSignature: (args: VerifyWebhookArgs) => Promise<boolean>;
};

export type PayPalError =
  | { kind: "timeout"; message: string }
  | { kind: "network"; message: string }
  | { kind: "provider_rejected"; status: number; message: string }
  | { kind: "invalid_response"; message: string };

export function isPayPalError(error: unknown): error is PayPalError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as { kind: unknown }).kind === "string"
  );
}

const PROVIDER_TIMEOUT_MS = 30_000;

/** Classify low-level failures into typed errors (secrets never included). */
function classifyHttpFailure(error: unknown): PayPalError {
  if (error instanceof Error && error.name === "AbortError") {
    return { kind: "timeout", message: "PayPal API request timed out" };
  }
  return {
    kind: "network",
    message: "PayPal API could not be reached",
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}

// ── OAuth2 client-credentials token cache ────────────────────────────────

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

export function resetTokenCacheForTests(): void {
  cachedToken = null;
}

async function getAccessToken(config: PayPalConfig): Promise<string> {
  const now = Date.now();
  // Refresh 60s before expiry to avoid using a stale token mid-request.
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetchWithTimeout(`${config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch (error) {
    throw classifyHttpFailure(error);
  }
  if (!response.ok) {
    throw {
      kind: "provider_rejected",
      status: response.status,
      message: "PayPal rejected the OAuth request — check the Sandbox credentials",
    } satisfies PayPalError;
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw { kind: "invalid_response", message: "PayPal token response was malformed" } satisfies PayPalError;
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + body.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

// ── Real transport over fetch ────────────────────────────────────────────

export function createPayPalTransport(config: PayPalConfig): PayPalTransport {
  async function authenticatedJson(
    method: "POST",
    path: string,
    body: Record<string, unknown>,
    requestId: string | null,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const accessToken = await getAccessToken(config);
    let response: Response;
    try {
      response = await fetchWithTimeout(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw classifyHttpFailure(error);
    }
    const text = await response.text();
    let json: Record<string, unknown> = {};
    if (text !== "") {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw { kind: "invalid_response", message: "PayPal returned malformed JSON" } satisfies PayPalError;
      }
    }
    if (!response.ok) {
      throw {
        kind: "provider_rejected",
        status: response.status,
        message: `PayPal API rejected the request (HTTP ${response.status})`,
      } satisfies PayPalError;
    }
    return { status: response.status, json };
  }

  return {
    async createOrder(args: CreateOrderArgs): Promise<PayPalOrderCreated> {
      const { json } = await authenticatedJson(
        "POST",
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: args.referenceId,
              description: `TrustCart demo order ${args.orderNumber}`.slice(0, 127),
              amount: { currency_code: args.currencyCode, value: args.amountValue },
            },
          ],
        },
        args.paypalRequestId,
      );
      if (typeof json.id !== "string" || typeof json.status !== "string") {
        throw { kind: "invalid_response", message: "PayPal order creation response was malformed" } satisfies PayPalError;
      }
      return { id: json.id, status: json.status };
    },

    async captureOrder(args: CaptureOrderArgs): Promise<PayPalCaptureResult> {
      const { json } = await authenticatedJson(
        "POST",
        `/v2/checkout/orders/${encodeURIComponent(args.providerOrderId)}/capture`,
        {},
        args.paypalRequestId,
      );
      if (typeof json.id !== "string" || typeof json.status !== "string") {
        throw { kind: "invalid_response", message: "PayPal capture response was malformed" } satisfies PayPalError;
      }
      const purchaseUnits = json.purchase_units as
        | {
            payments?: {
              captures?: {
                id: string;
                status: string;
                amount?: { currency_code: string; value: string };
              }[];
            };
          }[]
        | undefined;
      const rawCapture = purchaseUnits?.[0]?.payments?.captures?.[0];
      return {
        id: json.id,
        status: json.status,
        capture: rawCapture
          ? {
              id: rawCapture.id,
              status: rawCapture.status,
              amount: rawCapture.amount
                ? { currency_code: rawCapture.amount.currency_code, value: rawCapture.amount.value }
                : null,
            }
          : null,
      };
    },

    async verifyWebhookSignature(args: VerifyWebhookArgs): Promise<boolean> {
      const { json } = await authenticatedJson(
        "POST",
        "/v1/notifications/verify-webhook-signature",
        {
          auth_algo: args.authAlgo,
          cert_url: args.certUrl,
          transmission_id: args.transmissionId,
          transmission_sig: args.transmissionSig,
          transmission_time: args.transmissionTime,
          webhook_id: args.webhookId,
          webhook_event: args.webhookEvent,
        },
        null,
      );
      return json.verification_status === "SUCCESS";
    },
  };
}
