import { describe, expect, it } from "vitest";
import { DEMO_MERCHANT, DEMO_ORDERS } from "@/lib/demo/demo-data";
import { levelForScore } from "@/lib/risk/engine";

/**
 * Phase 6 regression: the static demo fallback dataset (shown when the
 * database is unreachable) must use the SAME band mapping as the
 * deterministic engine (HIGH ≥ 70, MEDIUM ≥ 35, else LOW), so a labelled
 * fallback row can never contradict a database-backed row for the same
 * score. Discovered by the Phase 6 QA review: 6 rows used ad-hoc bands.
 */
describe("demo dataset consistency", () => {
  it("maps every DEMO_ORDERS riskBand with the engine's levelForScore", () => {
    const mismatches = DEMO_ORDERS.filter(
      (order) => order.riskBand !== levelForScore(order.riskScore),
    );
    expect(
      mismatches.map(
        (order) => `${order.number} score=${order.riskScore} band=${order.riskBand}`,
      ),
    ).toEqual([]);
  });

  it("never claims shipped features are still scheduled", () => {
    // Phase 6: the risk engine, copilot, and PayPal Sandbox checkout are all
    // implemented — the settings environment-status card must not describe
    // them as future work.
    for (const note of DEMO_MERCHANT.notes) {
      expect(note.active, `${note.label} must not be marked scheduled`).toBe(true);
    }
  });
});
