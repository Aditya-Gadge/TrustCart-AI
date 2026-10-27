import {
  ACCOUNT_AGE,
  COMPOUND,
  HIGH_VALUE_THRESHOLDS,
  ODD_HOUR,
  REASON_META,
  RISK_RULES_VERSION,
  SCORE,
  VELOCITY,
  WEIGHTS,
  type ReasonCode,
} from "@/lib/risk/rules";

/**
 * TrustCart AI — deterministic, versioned risk engine (Phase 3).
 *
 * ⚠️ Demo heuristics for the hackathon dataset — NOT validated fraud
 * predictions. Pure function: same input → byte-identical output. No I/O,
 * no clock access (time signals derive only from the order's own `placedAt`),
 * and — by construction — no access to the evaluation-only label table.
 *
 * Output: score 0–100, band, and one entry per fired reason with points,
 * a human-readable explanation, and the EXACT evidence (observed value +
 * threshold) that justified it, so the UI can show the support for every
 * displayed reason. Correlated tier variants are mutually exclusive (see
 * rules.ts), so correlated signals are never double-counted.
 */

export type RiskInput = {
  /** Minor units (cents). Invalid/missing → signal skipped + documented. */
  amountMinor?: number | null;
  currency?: string | null;
  accountAgeDays?: number | null;
  recentOrderCount?: number | null;
  shippingMismatch?: boolean | null;
  /** The order's own placement timestamp (no wall-clock reads). */
  placedAt?: Date | string | null;
};

export type RiskEvidence = { label: string; value: string };

export type RiskReason = {
  code: ReasonCode;
  label: string;
  points: number;
  explanation: string;
  /** Exact observed values + thresholds that justify this reason. */
  evidence: RiskEvidence[];
};

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RiskAssessmentResult = {
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
  rulesVersion: string;
};

/** Deterministic band mapping (documented): HIGH ≥ 70, MEDIUM ≥ 35, else LOW. */
export function levelForScore(score: number): RiskLevel {
  if (score >= 70) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function isUsableInt(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Deterministic minor-unit money formatting (no Intl — stable across hosts). */
export function formatMinorForEvidence(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${grouped}.${cents} ${currency}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildReason(code: ReasonCode, evidence: RiskEvidence[]): RiskReason {
  return {
    code,
    label: REASON_META[code].label,
    points: WEIGHTS[code],
    explanation: REASON_META[code].explanation,
    evidence,
  };
}

const COMPOUND_PARTICIPANTS = [
  "DEMO_HIGH_VALUE",
  "DEMO_VERY_HIGH_VALUE",
  "DEMO_ORDER_VELOCITY",
  "DEMO_EXTREME_VELOCITY",
  "DEMO_NEW_ACCOUNT",
  "DEMO_NEWER_ACCOUNT",
  "DEMO_SHIPPING_MISMATCH",
] as const;

const COMPOUND_CATEGORY_LABEL: Partial<Record<ReasonCode, string>> = {
  DEMO_HIGH_VALUE: "high order value",
  DEMO_VERY_HIGH_VALUE: "extreme order value",
  DEMO_ORDER_VELOCITY: "order velocity",
  DEMO_EXTREME_VELOCITY: "extreme order velocity",
  DEMO_NEW_ACCOUNT: "very new account",
  DEMO_NEWER_ACCOUNT: "newer account",
  DEMO_SHIPPING_MISMATCH: "shipping/billing mismatch",
};

export function assessOrder(input: RiskInput): RiskAssessmentResult {
  const reasons: RiskReason[] = [];
  const missing: string[] = [];

  // ── Order value (per-currency thresholds; tiers mutually exclusive) ──
  const currency = input.currency ?? null;
  const thresholds = currency !== null ? HIGH_VALUE_THRESHOLDS[currency] : undefined;
  if (!isUsableInt(input.amountMinor)) {
    missing.push("amountMinor");
  } else if (currency === null || thresholds === undefined) {
    missing.push(`currency (${currency ?? "none"} has no demo thresholds)`);
  } else if (input.amountMinor >= thresholds.tier2) {
    reasons.push(
      buildReason("DEMO_VERY_HIGH_VALUE", [
        { label: "Order total", value: formatMinorForEvidence(input.amountMinor, currency) },
        { label: "Top-tier threshold", value: `≥ ${formatMinorForEvidence(thresholds.tier2, currency)}` },
      ]),
    );
  } else if (input.amountMinor >= thresholds.tier1) {
    reasons.push(
      buildReason("DEMO_HIGH_VALUE", [
        { label: "Order total", value: formatMinorForEvidence(input.amountMinor, currency) },
        { label: "Threshold", value: `≥ ${formatMinorForEvidence(thresholds.tier1, currency)}` },
      ]),
    );
  }

  // ── Order velocity (tiers mutually exclusive) ──
  if (!isUsableInt(input.recentOrderCount)) {
    missing.push("recentOrderCount");
  } else if (input.recentOrderCount >= VELOCITY.tier2) {
    reasons.push(
      buildReason("DEMO_EXTREME_VELOCITY", [
        { label: `Orders in ${VELOCITY.windowLabel}`, value: String(input.recentOrderCount) },
        { label: "Top-tier threshold", value: `≥ ${VELOCITY.tier2}` },
      ]),
    );
  } else if (input.recentOrderCount >= VELOCITY.tier1) {
    reasons.push(
      buildReason("DEMO_ORDER_VELOCITY", [
        { label: `Orders in ${VELOCITY.windowLabel}`, value: String(input.recentOrderCount) },
        { label: "Threshold", value: `≥ ${VELOCITY.tier1}` },
      ]),
    );
  }

  // ── Account age (tiers mutually exclusive) ──
  if (!isUsableInt(input.accountAgeDays)) {
    missing.push("accountAgeDays");
  } else if (input.accountAgeDays < ACCOUNT_AGE.veryNewDays) {
    reasons.push(
      buildReason("DEMO_NEW_ACCOUNT", [
        { label: "Account age", value: `${input.accountAgeDays} days` },
        { label: "Threshold", value: `< ${ACCOUNT_AGE.veryNewDays} days` },
      ]),
    );
  } else if (input.accountAgeDays < ACCOUNT_AGE.newerDays) {
    reasons.push(
      buildReason("DEMO_NEWER_ACCOUNT", [
        { label: "Account age", value: `${input.accountAgeDays} days` },
        { label: "Threshold", value: `< ${ACCOUNT_AGE.newerDays} days` },
      ]),
    );
  }

  // ── Shipping/billing mismatch indicator (when the merchant feed supplies it) ──
  if (input.shippingMismatch === null || input.shippingMismatch === undefined) {
    missing.push("shippingMismatch");
  } else if (input.shippingMismatch) {
    reasons.push(
      buildReason("DEMO_SHIPPING_MISMATCH", [
        { label: "Merchant feed indicator", value: "true — mismatch flagged" },
      ]),
    );
  }

  // ── Odd-hour placement (derives ONLY from the order's own timestamp) ──
  if (input.placedAt !== null && input.placedAt !== undefined) {
    const parsed = input.placedAt instanceof Date ? input.placedAt : new Date(input.placedAt);
    if (!Number.isNaN(parsed.getTime())) {
      const hour = parsed.getUTCHours();
      if (hour >= ODD_HOUR.fromUtc && hour <= ODD_HOUR.toUtcInclusive) {
        reasons.push(
          buildReason("DEMO_ODD_HOUR", [
            {
              label: "Placed at (UTC)",
              value: `${pad2(parsed.getUTCFullYear())}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())} ${pad2(hour)}:${pad2(parsed.getUTCMinutes())}`,
            },
            { label: "Window", value: `${pad2(ODD_HOUR.fromUtc)}:00–${pad2(ODD_HOUR.toUtcInclusive)}:59 UTC` },
          ]),
        );
      }
    } else {
      missing.push("placedAt (unparseable)");
    }
  } else {
    missing.push("placedAt");
  }

  // ── Documented compound interaction: fires ONCE across independent categories ──
  const categories = [
    ...new Set(
      reasons
        .map((r) => r.code)
        .filter((code): code is (typeof COMPOUND_PARTICIPANTS)[number] =>
          (COMPOUND_PARTICIPANTS as readonly string[]).includes(code),
        )
        .map((code) => COMPOUND_CATEGORY_LABEL[code] ?? code),
    ),
  ];
  if (categories.length >= COMPOUND.minSignals) {
    reasons.push(
      buildReason("DEMO_COMPOUND_RISK", [
        { label: "Independent signals present", value: `${categories.length}: ${categories.join(", ")}` },
        { label: "Rule", value: `bonus applies at ≥ ${COMPOUND.minSignals} independent signals` },
      ]),
    );
  }

  if (missing.length > 0) {
    reasons.push(
      buildReason("DEMO_INCOMPLETE_DATA", [
        { label: "Missing or invalid inputs", value: missing.join("; ") },
        { label: "Effect", value: "related signals skipped; no points added" },
      ]),
    );
  }

  const raw = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const score = Math.min(SCORE.max, Math.max(SCORE.min, raw));

  return {
    score,
    level: levelForScore(score),
    reasons,
    rulesVersion: RISK_RULES_VERSION,
  };
}
