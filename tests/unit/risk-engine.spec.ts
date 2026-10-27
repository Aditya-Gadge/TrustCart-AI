import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessOrder, levelForScore, formatMinorForEvidence } from "@/lib/risk/engine";
import { RISK_RULES_VERSION } from "@/lib/risk/rules";

/**
 * Golden fixtures for the deterministic risk engine (Phase 3).
 * Covers: score boundaries 0–100, level band edges, per-signal thresholds,
 * mutually exclusive tiers (correlated signals never stack), missing/invalid
 * data, combined + compound signals, byte-identical determinism, evidence
 * presence, and the EvalLabel isolation guard.
 */
const ALL_SIGNALS: Parameters<typeof assessOrder>[0] = {
  amountMinor: 250_000,
  currency: "USD",
  accountAgeDays: 5,
  recentOrderCount: 12,
  shippingMismatch: true,
  placedAt: "2026-10-13T03:27:00.000Z",
};

describe("risk engine — level bands", () => {
  it("maps documented band edges exactly", () => {
    expect(levelForScore(0)).toBe("LOW");
    expect(levelForScore(34)).toBe("LOW");
    expect(levelForScore(35)).toBe("MEDIUM");
    expect(levelForScore(69)).toBe("MEDIUM");
    expect(levelForScore(70)).toBe("HIGH");
    expect(levelForScore(100)).toBe("HIGH");
  });
});

describe("risk engine — empty and missing data", () => {
  it("scores an empty order 0 / LOW with only the informational reason", () => {
    const result = assessOrder({});
    expect(result.score).toBe(0);
    expect(result.level).toBe("LOW");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.code).toBe("DEMO_INCOMPLETE_DATA");
    expect(result.reasons[0]?.points).toBe(0);
    expect(result.reasons[0]?.evidence.map((e) => e.label)).toContain("Missing or invalid inputs");
  });

  it("skips only the signal whose input is missing, not the others", () => {
    const result = assessOrder({
      amountMinor: 90_000,
      currency: "USD",
      accountAgeDays: null,
      recentOrderCount: 7,
      shippingMismatch: false,
      placedAt: null,
    });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("DEMO_HIGH_VALUE");
    expect(codes).toContain("DEMO_ORDER_VELOCITY");
    expect(codes).not.toContain("DEMO_NEW_ACCOUNT");
    expect(codes).not.toContain("DEMO_NEWER_ACCOUNT");
    const missing = result.reasons.find((r) => r.code === "DEMO_INCOMPLETE_DATA");
    expect(JSON.stringify(missing?.evidence)).toContain("accountAgeDays");
    expect(JSON.stringify(missing?.evidence)).toContain("placedAt");
    expect(result.score).toBe(27); // 12 + 15, no compound (2 categories)
  });

  it("treats negative, fractional, and non-finite numbers as missing", () => {
    for (const amount of [-5, 1.5]) {
      const result = assessOrder({ amountMinor: amount, currency: "USD" });
      expect(result.reasons.map((r) => r.code)).toContain("DEMO_INCOMPLETE_DATA");
      expect(result.reasons.map((r) => r.code)).not.toContain("DEMO_HIGH_VALUE");
    }
  });

  it("treats an unsupported currency as missing rather than applying USD thresholds", () => {
    const result = assessOrder({ amountMinor: 90_000, currency: "JPY" });
    expect(result.reasons.map((r) => r.code)).not.toContain("DEMO_HIGH_VALUE");
    const missing = result.reasons.find((r) => r.code === "DEMO_INCOMPLETE_DATA");
    expect(JSON.stringify(missing?.evidence)).toContain("currency");
  });
});

describe("risk engine — high value thresholds (per currency)", () => {
  it("fires exactly at the USD tier-1 boundary", () => {
    expect(assessOrder({ amountMinor: 80_000, currency: "USD" }).reasons.map((r) => r.code)).toContain(
      "DEMO_HIGH_VALUE",
    );
    expect(assessOrder({ amountMinor: 79_999, currency: "USD" }).reasons.map((r) => r.code)).not.toContain(
      "DEMO_HIGH_VALUE",
    );
  });

  it("uses documented EUR/GBP thresholds", () => {
    expect(assessOrder({ amountMinor: 75_000, currency: "EUR" }).reasons.map((r) => r.code)).toContain(
      "DEMO_HIGH_VALUE",
    );
    expect(assessOrder({ amountMinor: 74_999, currency: "EUR" }).reasons.map((r) => r.code)).not.toContain(
      "DEMO_HIGH_VALUE",
    );
    expect(assessOrder({ amountMinor: 70_000, currency: "GBP" }).reasons.map((r) => r.code)).toContain(
      "DEMO_HIGH_VALUE",
    );
  });

  it("selects the top value tier instead of stacking tiers (correlated signals)", () => {
    const result = assessOrder({ amountMinor: 250_000, currency: "USD" });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("DEMO_VERY_HIGH_VALUE");
    expect(codes).not.toContain("DEMO_HIGH_VALUE");
    expect(result.score).toBe(25);
  });
});

describe("risk engine — velocity tiers (exclusive)", () => {
  it("fires tier 1 at exactly 6 orders", () => {
    const result = assessOrder({ recentOrderCount: 6 });
    expect(result.reasons.map((r) => r.code)).toContain("DEMO_ORDER_VELOCITY");
    expect(result.score).toBe(15);
  });

  it("fires only the top velocity tier at 12 orders", () => {
    const result = assessOrder({ recentOrderCount: 12 });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("DEMO_EXTREME_VELOCITY");
    expect(codes).not.toContain("DEMO_ORDER_VELOCITY");
    expect(result.score).toBe(25);
  });
});

describe("risk engine — account age tiers (exclusive)", () => {
  it("fires the very-new tier below 14 days", () => {
    const result = assessOrder({ accountAgeDays: 13 });
    expect(result.reasons.map((r) => r.code)).toContain("DEMO_NEW_ACCOUNT");
    expect(result.score).toBe(20);
  });

  it("fires the newer-account tier at exactly 14 days (14–89 band)", () => {
    const result = assessOrder({ accountAgeDays: 14 });
    expect(result.reasons.map((r) => r.code)).toContain("DEMO_NEWER_ACCOUNT");
    expect(result.score).toBe(8);
  });

  it("fires the newer-account tier for 14–89 days and nothing at 90", () => {
    const at89 = assessOrder({ accountAgeDays: 89 });
    expect(at89.reasons.map((r) => r.code)).toContain("DEMO_NEWER_ACCOUNT");
    expect(at89.score).toBe(8);

    const at90 = assessOrder({ accountAgeDays: 90 });
    expect(at90.reasons.map((r) => r.code)).not.toContain("DEMO_NEWER_ACCOUNT");
    expect(at90.score).toBe(0);
  });
});

describe("risk engine — shipping mismatch and odd hour", () => {
  it("adds mismatch points only when the indicator is true", () => {
    expect(assessOrder({ shippingMismatch: true }).score).toBe(25);
    expect(assessOrder({ shippingMismatch: false }).score).toBe(0);
  });

  it("fires odd hour inside 01:00–04:59 UTC only, evidence includes the timestamp", () => {
    const at3 = assessOrder({ placedAt: "2026-10-13T03:27:00.000Z" });
    const odd = at3.reasons.find((r) => r.code === "DEMO_ODD_HOUR");
    expect(odd).toBeDefined();
    expect(JSON.stringify(odd?.evidence)).toContain("03:27");

    expect(assessOrder({ placedAt: "2026-10-13T05:00:00.000Z" }).reasons.map((r) => r.code)).not.toContain(
      "DEMO_ODD_HOUR",
    );
    expect(assessOrder({ placedAt: "2026-10-13T00:59:00.000Z" }).reasons.map((r) => r.code)).not.toContain(
      "DEMO_ODD_HOUR",
    );
  });
});

describe("risk engine — combined and conflicting signals", () => {
  it("sums independent signals and adds the compound bonus at exactly 3 categories", () => {
    // high value (12) + velocity tier1 (15) + newer account (8) = 35, 3 categories → +10 → 45
    const result = assessOrder({
      amountMinor: 90_000,
      currency: "USD",
      accountAgeDays: 45,
      recentOrderCount: 7,
      shippingMismatch: false,
    });
    expect(result.score).toBe(45);
    const compound = result.reasons.find((r) => r.code === "DEMO_COMPOUND_RISK");
    expect(JSON.stringify(compound?.evidence)).toContain("3:");
  });

  it("counts value and account tiers as ONE category each for the compound rule", () => {
    // very-high value (25) + extreme velocity (25) + very new account (20) + mismatch (25) + odd hour (8) = 103 → clamp 100
    const result = assessOrder(ALL_SIGNALS);
    expect(result.score).toBe(100);
    expect(result.level).toBe("HIGH");
    const compound = result.reasons.find((r) => r.code === "DEMO_COMPOUND_RISK");
    expect(JSON.stringify(compound?.evidence)).toContain("4:");
  });

  it("does not add a compound bonus for fewer than 3 independent categories", () => {
    // mismatch (25) + odd hour (8, excluded from the count) = 33
    const result = assessOrder({ shippingMismatch: true, placedAt: "2026-10-13T02:00:00.000Z" });
    expect(result.score).toBe(33);
    expect(result.reasons.map((r) => r.code)).not.toContain("DEMO_COMPOUND_RISK");
  });

  it("conflicting direction: brand-new account with otherwise calm signals stays moderate", () => {
    // very new account (20) + odd hour (8) — nothing else
    const result = assessOrder({
      amountMinor: 2_000,
      currency: "USD",
      accountAgeDays: 3,
      recentOrderCount: 0,
      shippingMismatch: false,
      placedAt: "2026-10-13T03:00:00.000Z",
    });
    expect(result.score).toBe(28);
    expect(result.level).toBe("LOW");
  });

  it("clamps at 100 and floors at 0", () => {
    expect(assessOrder(ALL_SIGNALS).score).toBe(100);
    expect(assessOrder({}).score).toBe(0);
  });
});

describe("risk engine — determinism, evidence, and isolation", () => {
  it("is byte-identical for identical inputs (no clock or randomness)", () => {
    const a = assessOrder(ALL_SIGNALS);
    const b = assessOrder(ALL_SIGNALS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stamps the current rules version on every result", () => {
    expect(assessOrder(ALL_SIGNALS).rulesVersion).toBe(RISK_RULES_VERSION);
  });

  it("gives every scoring reason non-empty explanation and evidence with labels+values", () => {
    const result = assessOrder(ALL_SIGNALS);
    for (const reason of result.reasons) {
      expect(reason.explanation.length).toBeGreaterThan(10);
      expect(reason.label.length).toBeGreaterThan(0);
      if (reason.code !== "DEMO_INCOMPLETE_DATA") {
        expect(reason.evidence.length).toBeGreaterThan(0);
        for (const item of reason.evidence) {
          expect(item.label.length).toBeGreaterThan(0);
          expect(item.value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("formats minor units deterministically for evidence", () => {
    expect(formatMinorForEvidence(80_000, "USD")).toBe("$800.00 USD");
    expect(formatMinorForEvidence(1_234_567, "EUR")).toBe("€12,345.67 EUR");
    expect(formatMinorForEvidence(5, "GBP")).toBe("£0.05 GBP");
    expect(formatMinorForEvidence(-250, "USD")).toBe("-$2.50 USD");
    expect(formatMinorForEvidence(100, "JPY")).toBe("1.00 JPY");
  });

  it("never reads the evaluation-only fraud-label table (source isolation guard)", () => {
    const engineSource = readFileSync(
      join(process.cwd(), "src", "lib", "risk", "engine.ts"),
      "utf8",
    );
    const rulesSource = readFileSync(
      join(process.cwd(), "src", "lib", "risk", "rules.ts"),
      "utf8",
    );
    for (const source of [engineSource, rulesSource]) {
      expect(source).not.toContain("EvalLabel");
      expect(source).not.toContain("generated/prisma/client");
      expect(source).not.toContain("db/client");
    }
  });
});
