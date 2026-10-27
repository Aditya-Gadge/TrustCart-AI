import { z } from "zod";
import { REVIEW_ACTIONS } from "@/lib/review/transitions";

/**
 * Validated review-action payload (Phase 3). Every consequential review
 * action requires a reason — enforced HERE (server-side), independent of
 * any client state. `expectedUpdatedAt` implements optimistic concurrency:
 * the client echoes back the `updatedAt` it saw; a mismatch means another
 * update landed first and the write is rejected instead of overwriting it.
 */
export const reviewActionSchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  reason: z
    .string()
    .trim()
    .min(4, "A reason of at least 4 characters is required")
    .max(280, "Reasons are limited to 280 characters"),
  expectedUpdatedAt: z.iso.datetime({ offset: true, local: true }),
});

export type ReviewActionInput = z.infer<typeof reviewActionSchema>;
