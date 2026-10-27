import { describe, expect, it } from "vitest";
import type { EvaluationLabel } from "@/generated/prisma/client";
import { RISK_RULES_VERSION } from "@/lib/risk/rules";
import {
  SEED_BASE_DATE,
  generateSyntheticDataset,
  type SeedOrder,
} from "@/seed/generate-demo-orders";

/**
 * Unit tests for the deterministic synthetic order generator (Phase 3).
 * The dataset must be a pure function of (seed, count): identical inputs
 * produce identical datasets; the class distribution is exact by design
 * (68% ORDINARY / 16% HIGH_VALUE / 10% REPEATED / 6% SUSPICIOUS) and risk
 * snapshots come from the real deterministic engine.
 */
function serialize(dataset: { orders: SeedOrder[] }): string {
  return JSON.stringify(dataset.orders);
}

function expectedClass(index: number): EvaluationLabel {
  const slot = index % 100;
  if (slot < 68) return "ORDINARY";
  if (slot < 84) return "HIGH_VALUE";
  if (slot < 94) return "REPEATED";
  return "SUSPICIOUS";
}

function expectedClassCount(count: number, klass: EvaluationLabel): number {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (expectedClass(i) === klass) total += 1;
  }
  return total;
}

function tally(dataset: { orders: SeedOrder[] }): Map<string, number> {
  const counts = new Map<string, number>();
  for (const order of dataset.orders) {
    counts.set(order.evalLabel, (counts.get(order.evalLabel) ?? 0) + 1);
  }
  return counts;
}

describe("generateSyntheticDataset", () => {
  it("produces identical datasets for identical (seed, count)", () => {
    const a = generateSyntheticDataset(20261027, 500);
    const b = generateSyntheticDataset(20261027, 500);
    expect(serialize(a)).toBe(serialize(b));
  });

  it("produces different datasets for different seeds", () => {
    const a = generateSyntheticDataset(20261027, 500);
    const b = generateSyntheticDataset(20261028, 500);
    expect(serialize(a)).not.toBe(serialize(b));
  });

  it("enforces the 500–2000 order count bounds", () => {
    expect(() => generateSyntheticDataset(1, 499)).toThrow();
    expect(() => generateSyntheticDataset(1, 2001)).toThrow();
    expect(() => generateSyntheticDataset(1, 500)).not.toThrow();
    expect(() => generateSyntheticDataset(1, 2000)).not.toThrow();
  });

  it("enforces a positive 32-bit integer seed", () => {
    expect(() => generateSyntheticDataset(0, 800)).toThrow();
    expect(() => generateSyntheticDataset(-5, 800)).toThrow();
    expect(() => generateSyntheticDataset(2_147_483_648, 800)).toThrow();
    expect(() => generateSyntheticDataset(1.5, 800)).toThrow();
    expect(() => generateSyntheticDataset(2_147_483_647, 800)).not.toThrow();
  });

  it("meets the documented exact class proportions", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    const counts = tally(dataset);
    for (const klass of ["ORDINARY", "HIGH_VALUE", "REPEATED", "SUSPICIOUS"] as const) {
      expect(counts.get(klass)).toBe(expectedClassCount(800, klass));
    }
  });

  it("uses the fixed base date and integer minor-unit money", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    expect(dataset.baseDate).toBe(SEED_BASE_DATE);
    for (const order of dataset.orders) {
      expect(Number.isInteger(order.amount)).toBe(true);
      expect(order.amount).toBeGreaterThan(0);
      expect(order.currency).toMatch(/^(USD|EUR|GBP)$/);
      expect(order.itemCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("produces synthetic emails only (no real-customer data)", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    for (const order of dataset.orders) {
      expect(order.customerEmail).toMatch(/@demo\.example$/);
    }
  });

  it("keeps order numbers unique", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    const numbers = dataset.orders.map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("computes risk via the real engine (0–100, band-consistent, evidence present)", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    const seenRules = new Set<string>();
    for (const order of dataset.orders) {
      const { score, level, reasons, rulesVersion } = order.risk;
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(rulesVersion).toBe(RISK_RULES_VERSION);
      expect(level).toBe(score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW");
      for (const reason of reasons) {
        expect(typeof reason.code).toBe("string");
        expect(typeof reason.label).toBe("string");
        expect(Number.isInteger(reason.points)).toBe(true);
        expect(typeof reason.explanation).toBe("string");
        seenRules.add(reason.code);
      }
      // Odd-hour invariant: feature ⇒ reason, and contrapositive.
      const hour = order.createdAt.getUTCHours();
      const hasOddReason = reasons.some((r) => r.code === "DEMO_ODD_HOUR");
      expect(hasOddReason).toBe(hour >= 1 && hour <= 4);
    }
    // The dataset spans classes that must exercise value + velocity + account signals.
    expect(seenRules).toContain("DEMO_HIGH_VALUE");
    expect(seenRules).toContain("DEMO_ORDER_VELOCITY");
    expect(seenRules).toContain("DEMO_NEW_ACCOUNT");
    // All seed inputs are complete, so the informational reason never fires.
    expect(seenRules).not.toContain("DEMO_INCOMPLETE_DATA");
  });

  it("keeps evaluation labels aligned with class-specific feature ranges", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    for (const order of dataset.orders) {
      switch (order.evalLabel) {
        case "HIGH_VALUE":
          expect(order.amount).toBeGreaterThanOrEqual(80_000);
          break;
        case "SUSPICIOUS":
          expect(order.accountAgeDays).toBeLessThanOrEqual(12);
          break;
        case "REPEATED":
          expect(order.recentOrderCount).toBeGreaterThanOrEqual(6);
          break;
        case "ORDINARY":
          break;
      }
    }
  });

  it("never includes payment-related data", () => {
    const dataset = generateSyntheticDataset(20261027, 800);
    const keys = new Set(Object.keys(dataset.orders[0]));
    expect(keys.has("payments")).toBe(false);
    expect(keys.has("payment")).toBe(false);
    for (const key of Object.keys(dataset.orders[0])) {
      expect(key.toLowerCase()).not.toContain("payment");
    }
  });
});
