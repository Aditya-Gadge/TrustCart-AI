import { z } from "zod";

/**
 * Validated search/filter parameters for order retrieval. Shared by the
 * API route (authoritative) and consumed client-side to stay consistent.
 * Unknown or malformed values are rejected rather than coerced silently.
 */

export const reviewStatusFilterSchema = z.enum([
  "ALL",
  "PENDING",
  "APPROVED",
  "HELD_FOR_REVIEW",
]);

export const riskBandFilterSchema = z.enum([
  "ALL",
  "LOW",
  "MEDIUM",
  "HIGH",
]);

export const orderSortSchema = z.enum([
  "newest",
  "oldest",
  "risk_high",
  "risk_low",
  "amount_high",
  "amount_low",
]);

export const orderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  q: z
    .string()
    .trim()
    .max(80, "Search text is limited to 80 characters")
    .default(""),
  status: reviewStatusFilterSchema.default("ALL"),
  band: riskBandFilterSchema.default("ALL"),
  sort: orderSortSchema.default("newest"),
});

export type OrderQuery = z.output<typeof orderQuerySchema>;
export type OrderSort = z.infer<typeof orderSortSchema>;

/** Parses URLSearchParams, returning a discriminated result. */
export function parseOrderQuery(
  params: URLSearchParams,
): { ok: true; query: OrderQuery } | { ok: false } {
  const raw = {
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    band: params.get("band") ?? undefined,
    sort: params.get("sort") ?? undefined,
  };
  const parsed = orderQuerySchema.safeParse(raw);
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false };
}
