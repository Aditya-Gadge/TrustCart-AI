import type { RiskLevel } from "@/lib/risk/engine";

/**
 * Review workflow rules (Phase 3) — shared by the server (authoritative)
 * and the client (to render which actions are offered). The server never
 * trusts a client-declared target status: the target is derived from the
 * action and validated against this matrix server-side.
 */

export const REVIEW_ACTIONS = ["APPROVE", "HOLD", "RESET_TO_PENDING"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export type OrderStatusKey = "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";

export const TARGET_STATUS: Record<ReviewAction, OrderStatusKey> = {
  APPROVE: "APPROVED",
  HOLD: "HELD_FOR_REVIEW",
  RESET_TO_PENDING: "PENDING",
};

export const REVIEW_DECISION: Record<ReviewAction, "APPROVED" | "HELD_FOR_REVIEW" | "PENDING"> =
  TARGET_STATUS;

/**
 * Authoritative transition matrix. Consequential actions (all three change
 * state) require a reason — enforced server-side in the Zod schema.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatusKey, readonly ReviewAction[]> = {
  PENDING: ["APPROVE", "HOLD"],
  HELD_FOR_REVIEW: ["APPROVE", "RESET_TO_PENDING"],
  APPROVED: ["HOLD", "RESET_TO_PENDING"],
};

export function isTransitionAllowed(from: OrderStatusKey, action: ReviewAction): boolean {
  return ALLOWED_TRANSITIONS[from].includes(action);
}

export const ACTION_LABEL: Record<ReviewAction, string> = {
  APPROVE: "Approve",
  HOLD: "Hold for review",
  RESET_TO_PENDING: "Reset to pending",
};

/**
 * The demo actor is set SERVER-SIDE only — clients cannot claim an identity.
 * A real authenticated merchant identity replaces this in a later phase
 * (documented limitation; no auth system exists in the hackathon scope yet).
 */
export const DEMO_REVIEWER = "demo-merchant";

export const REVIEW_ACTION_LABEL: Record<"PENDING" | "APPROVED" | "HELD_FOR_REVIEW", string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  HELD_FOR_REVIEW: "Held for review",
};

/** Re-export so UI layers can band-map without importing the engine twice. */
export type { RiskLevel };
