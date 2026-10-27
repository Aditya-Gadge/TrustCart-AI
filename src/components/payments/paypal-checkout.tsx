"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { Button } from "@/components/ui/button";

/**
 * PayPal Sandbox checkout (Phase 5).
 *
 * Honest division of trust: the browser only asks the server to create the
 * PayPal order (server computes amount/currency) and relays the PayPal order
 * reference after approval. Nothing else from the browser is trusted — the
 * server captures and verifies the outcome, and the UI renders only the
 * SERVER's verdict. Cancellation is reported locally (nothing was charged).
 */

type OutcomeState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "info"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; retryable: boolean };

type ErrorResponse = { error?: string; message?: string };

export function PayPalCheckout({
  orderId,
  orderNumber,
  amountLabel,
  clientId,
  currency,
}: {
  orderId: string;
  orderNumber: string;
  amountLabel: string;
  clientId: string | null;
  currency: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<OutcomeState>({ kind: "idle" });

  async function createPaypalOrder(): Promise<string> {
    setState({ kind: "busy", message: "Opening PayPal Sandbox checkout…" });
    const res = await fetch(`/api/orders/${orderId}/payments`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as ErrorResponse & {
      providerOrderId?: string | null;
    };
    if (!res.ok || typeof body.providerOrderId !== "string") {
      throw new Error(
        body.message ??
          (res.status === 503 && body.error === "payments_unconfigured"
            ? "PayPal Sandbox is not configured on the server."
            : "PayPal order could not be created."),
      );
    }
    return body.providerOrderId;
  }

  async function approveAndCapture(providerOrderId: string): Promise<void> {
    setState({ kind: "busy", message: "Confirming the payment with PayPal server-side…" });
    const res = await fetch(`/api/orders/${orderId}/payments/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerOrderId }),
    });
    const body = (await res.json().catch(() => ({}))) as ErrorResponse & {
      payment?: { status: string };
    };

    if (res.ok && body.payment?.status === "VERIFIED") {
      setState({
        kind: "success",
        message: `Payment verified server-side — ${amountLabel} captured for order ${orderNumber}.`,
      });
      router.refresh();
      return;
    }
    if (res.ok && body.payment?.status === "CAPTURED") {
      setState({
        kind: "info",
        message: "PayPal accepted the capture; it is pending on PayPal's side. The order shows as captured, not verified yet.",
      });
      router.refresh();
      return;
    }
    if (res.status === 402) {
      setState({ kind: "error", message: body.message ?? "PayPal declined the payment.", retryable: false });
      router.refresh();
      return;
    }
    if (res.status === 409) {
      setState({
        kind: "error",
        message: body.message ?? "The captured amount did not match the order and was recorded as failed.",
        retryable: false,
      });
      router.refresh();
      return;
    }
    if (res.status === 503 && body.error === "provider_timeout") {
      setState({
        kind: "error",
        message: "PayPal did not respond in time. Retrying is safe — the capture is idempotent.",
        retryable: true,
      });
      return;
    }
    setState({
      kind: "error",
      message: body.message ?? "The payment could not be confirmed. Try again shortly.",
      retryable: true,
    });
  }

  if (clientId === null) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-sm font-medium">PayPal Sandbox not configured</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox) in .env to
          enable checkout. No payment buttons are rendered without them.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Collect payment via PayPal Sandbox</p>
        <span className="rounded border border-line px-2 py-0.5 text-[10px] text-muted">
          Sandbox · {currency} · no real money
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Amount and currency are computed server-side from the order record; the
        server verifies every capture before it is recorded as received.
      </p>

      {state.kind === "success" ? (
        <div role="status" className="mt-3 rounded-md border border-primary/25 bg-primary-soft px-3 py-2 text-sm">
          {state.message}
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div role="alert" className="mt-3 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-sm">
          <p>{state.message}</p>
          {state.retryable ? (
            <p className="mt-1 text-xs text-muted">
              Reload this page to try the payment again.
            </p>
          ) : null}
        </div>
      ) : null}

      {state.kind === "info" ? (
        <div role="status" className="mt-3 rounded-md border border-line bg-background px-3 py-2 text-sm">
          {state.message}
        </div>
      ) : null}

      {state.kind === "busy" ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted">
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          {state.message}
        </p>
      ) : null}

      {state.kind !== "success" ? (
        <div className="mt-3">
          <PayPalScriptProvider
            options={{ clientId, currency, intent: "capture", components: "buttons" }}
          >
            <PayPalButtons
              style={{ layout: "horizontal", label: "pay" }}
              disabled={state.kind === "busy"}
              createOrder={async () => {
                try {
                  return await createPaypalOrder();
                } catch (error) {
                  setState({
                    kind: "error",
                    message: error instanceof Error ? error.message : "PayPal order could not be created.",
                    retryable: true,
                  });
                  throw error;
                }
              }}
              onApprove={async (data) => {
                // Local catch mirrors createOrder: if the capture fetch
                // itself rejects (network drop), the UI must show a
                // retryable error instead of an unhandled rejection that
                // can leave a permanent spinner.
                try {
                  await approveAndCapture(data.orderID);
                } catch {
                  setState({
                    kind: "error",
                    message: "Network error while confirming the payment. The capture is idempotent — you can retry safely.",
                    retryable: true,
                  });
                }
              }}
              onCancel={() => {
                setState({
                  kind: "info",
                  message: "Checkout cancelled — nothing was charged and no payment state changed.",
                });
              }}
              onError={() => {
                setState({
                  kind: "error",
                  message: "PayPal reported an error during checkout. You can retry safely.",
                  retryable: true,
                });
              }}
            />
          </PayPalScriptProvider>
          {state.kind === "error" ? (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => router.refresh()}>
              Reload to retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
