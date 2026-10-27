import { z } from "zod";

/**
 * Capture request body (Phase 5). The browser sends ONLY the PayPal order
 * reference it received from the approval flow — never amounts, currency,
 * status, or "success" flags. Everything authoritative is recomputed
 * server-side from the database and the PayPal API.
 */
export const capturePaymentSchema = z.object({
  providerOrderId: z
    .string()
    .trim()
    .min(2, "A PayPal order reference is required")
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "Malformed PayPal order reference"),
});

export type CapturePaymentInput = z.infer<typeof capturePaymentSchema>;
