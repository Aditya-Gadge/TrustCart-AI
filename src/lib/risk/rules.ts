/**
 * TrustCart AI — demo risk rules catalogue (Phase 3).
 *
 * ⚠️ DEMO HEURISTICS, NOT FRAUD PREDICTIONS ⚠️
 * Every weight/threshold below is an invented demo value for the hackathon
 * dataset. Nothing here is a validated fraud model; the UI must always
 * present it as "demo heuristic". The `RISK_RULES_VERSION` is stamped on
 * every persisted snapshot so explanations stay reproducible.
 *
 * Correlation / double-counting policy:
 * - Signals with graded tiers (order value, velocity, account age) are
 *   mutually exclusive: only the HIGHEST applicable tier fires, so correlated
 *   variants never stack.
 * - The compound bonus is a documented interaction term: it fires once when
 *   ≥ COMPOUND.MIN_SIGNALS of the four primary independent signal categories
 *   are present. The odd-hour signal is deliberately excluded from the count
 *   (weak contextual signal, not an independent risk category).
 * - v1 has no mitigating (negative) factors: absence of signals simply
 *   contributes zero. Documented limitation of the demo heuristic.
 *
 * ISOLATION: this catalogue and the engine must never read the evaluation-only
 * synthetic-label table. Enforced by tests/unit/risk-engine.spec.ts.
 */

export const RISK_RULES_VERSION = "demo-heuristics-v1";

/** Display labels + explanations per reason code (human-readable, non-README copy). */
export const REASON_META = {
  DEMO_HIGH_VALUE: {
    label: "Unusually high order value",
    explanation:
      "The order total exceeds the demo high-value threshold for its currency.",
  },
  DEMO_VERY_HIGH_VALUE: {
    label: "Extreme order value",
    explanation:
      "The order total far exceeds the demo high-value threshold — the top value tier replaces the lower tier instead of stacking with it.",
  },
  DEMO_ORDER_VELOCITY: {
    label: "Repeated orders in a short period",
    explanation:
      "The customer placed several orders inside the demo 30-day velocity window.",
  },
  DEMO_EXTREME_VELOCITY: {
    label: "Extreme order velocity",
    explanation:
      "Order velocity is far above the demo threshold — the top velocity tier replaces the lower tier instead of stacking with it.",
  },
  DEMO_NEW_ACCOUNT: {
    label: "Very new account",
    explanation:
      "The customer account is only days old, which the demo rules treat as the strongest account-age signal.",
  },
  DEMO_NEWER_ACCOUNT: {
    label: "Newer account",
    explanation:
      "The customer account is under 90 days old. This lower tier replaces — never stacks with — the very-new tier.",
  },
  DEMO_SHIPPING_MISMATCH: {
    label: "Shipping/billing mismatch indicator",
    explanation:
      "The merchant feed flagged a shipping/billing mismatch for this order.",
  },
  DEMO_ODD_HOUR: {
    label: "Odd-hour placement",
    explanation:
      "The order was placed in the 01:00–04:59 UTC window used by the demo rules.",
  },
  DEMO_COMPOUND_RISK: {
    label: "Multiple independent signals",
    explanation:
      "Several independent risk categories fired together, so the demo rules add a single documented interaction bonus.",
  },
  DEMO_INCOMPLETE_DATA: {
    label: "Incomplete order data",
    explanation:
      "Some expected inputs were missing or invalid, so the related signals were skipped. The score may understate the true risk; this reason carries no points.",
  },
} as const;

export type ReasonCode = keyof typeof REASON_META;

/** Per-currency high-value thresholds in minor units (documented demo approximations). */
export const HIGH_VALUE_THRESHOLDS: Record<string, { tier1: number; tier2: number }> = {
  USD: { tier1: 80_000, tier2: 250_000 },
  EUR: { tier1: 75_000, tier2: 235_000 },
  GBP: { tier1: 70_000, tier2: 220_000 },
};

export const VELOCITY = { tier1: 6, tier2: 12, windowLabel: "last 30 days" } as const;
export const ACCOUNT_AGE = { veryNewDays: 14, newerDays: 90 } as const;
export const ODD_HOUR = { fromUtc: 1, toUtcInclusive: 4 } as const;
export const COMPOUND = { minSignals: 3, bonus: 10 } as const;

/** Configurable weights (points) per reason code. Tiers are exclusive. */
export const WEIGHTS: Record<ReasonCode, number> = {
  DEMO_HIGH_VALUE: 12,
  DEMO_VERY_HIGH_VALUE: 25,
  DEMO_ORDER_VELOCITY: 15,
  DEMO_EXTREME_VELOCITY: 25,
  DEMO_NEW_ACCOUNT: 20,
  DEMO_NEWER_ACCOUNT: 8,
  DEMO_SHIPPING_MISMATCH: 25,
  DEMO_ODD_HOUR: 8,
  DEMO_COMPOUND_RISK: COMPOUND.bonus,
  DEMO_INCOMPLETE_DATA: 0,
};

export const SCORE = { min: 0, max: 100 } as const;
