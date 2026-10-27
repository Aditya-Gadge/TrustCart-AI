import { describe, expect, it } from "vitest";
import {
  decimalStringToMinorUnits,
  minorUnitsToDecimalString,
} from "@/lib/payments/money";
import { verifyCaptureAgainstOrder } from "@/lib/payments/flow";

/** Money conversion between integer minor units and PayPal decimal strings. */
describe("payments money conversion", () => {
  it("converts minor units to PayPal decimal strings without float math", () => {
    expect(minorUnitsToDecimalString(143481, "USD")).toBe("1434.81");
    expect(minorUnitsToDecimalString(5, "EUR")).toBe("0.05");
    expect(minorUnitsToDecimalString(100, "GBP")).toBe("1.00");
    expect(minorUnitsToDecimalString(0, "USD")).toBe("0.00");
  });

  it("converts PayPal decimal strings back to integer minor units", () => {
    expect(decimalStringToMinorUnits("1434.81", "USD")).toBe(143481);
    expect(decimalStringToMinorUnits("0.05", "EUR")).toBe(5);
    expect(decimalStringToMinorUnits("250.00", "GBP")).toBe(25_000);
  });

  it("rejects malformed values and unmapped currencies loudly", () => {
    expect(() => minorUnitsToDecimalString(5, "JPY")).toThrow(/Unsupported currency/);
    expect(() => decimalStringToMinorUnits("1434.8", "USD")).toThrow(/Malformed/);
    expect(() => decimalStringToMinorUnits("1434.811", "USD")).toThrow(/Malformed/);
    expect(() => decimalStringToMinorUnits("1434", "USD")).toThrow(/Malformed/);
    expect(() => decimalStringToMinorUnits("1.00", "XYZ")).toThrow(/Unsupported currency/);
  });

  it("parses large in-range values exactly (pure integer parse)", () => {
    // Phase 6 regression (security review finding): the old parse multiplied
    // floats (`whole * 10 ** exponent`); large values must round-trip
    // exactly through integer minor units.
    expect(decimalStringToMinorUnits("9999999999.99", "USD")).toBe(999_999_999_999);
    expect(decimalStringToMinorUnits("-12.34", "USD")).toBe(-1234);
  });

  it("fails loudly instead of silently losing precision beyond the safe integer range", () => {
    // 40000000000000155 needs 54 bits — NOT exactly representable as a
    // Number. The old float math returned a silently WRONG amount here; the
    // contract is to refuse the value instead.
    expect(() => decimalStringToMinorUnits("400000000000001.55", "USD")).toThrow(
      /safe integer/,
    );
  });
});

/** The server-side capture verification contract (never trusts the client). */
describe("capture verification against the trusted order", () => {
  const ORDER_ID = "paypal-order-1";
  const amountOf = (minor: number) => ({
    currency_code: "USD",
    value: minorUnitsToDecimalString(minor, "USD"),
  });

  it("accepts a COMPLETED capture that matches order id, amount, and currency", () => {
    const result = verifyCaptureAgainstOrder(
      { id: ORDER_ID, status: "COMPLETED", capture: { id: "cap-1", status: "COMPLETED", amount: amountOf(143481) } },
      ORDER_ID,
      143481,
      "USD",
    );
    expect(result).toEqual({ ok: true, captureId: "cap-1" });
  });

  it("accepts a PENDING capture (mapped to CAPTURED, not VERIFIED)", () => {
    const result = verifyCaptureAgainstOrder(
      { id: ORDER_ID, status: "PENDING", capture: { id: "cap-2", status: "PENDING", amount: amountOf(143481) } },
      ORDER_ID,
      143481,
      "USD",
    );
    expect(result).toEqual({ ok: true, captureId: "cap-2" });
  });

  it("rejects an amount mismatch and reports the provider's actual amount", () => {
    const result = verifyCaptureAgainstOrder(
      { id: ORDER_ID, status: "COMPLETED", capture: { id: "cap-3", status: "COMPLETED", amount: amountOf(100) } },
      ORDER_ID,
      143481,
      "USD",
    );
    // Phase 6: the outcome must carry the ACTUAL amount for the 409 response
    // and audit trail (the old code hid it behind a hardcoded -1).
    expect(result).toEqual({
      ok: false,
      reason: "amount_mismatch",
      actualMinor: 100,
      actualCurrency: "USD",
    });
  });

  it("rejects a currency mismatch even for the same numeric amount", () => {
    const result = verifyCaptureAgainstOrder(
      {
        id: ORDER_ID,
        status: "COMPLETED",
        capture: { id: "cap-4", status: "COMPLETED", amount: { currency_code: "EUR", value: "1434.81" } },
      },
      ORDER_ID,
      143481,
      "USD",
    );
    expect(result).toEqual({
      ok: false,
      reason: "amount_mismatch",
      actualMinor: 143481,
      actualCurrency: "EUR",
    });
  });

  it("rejects a capture response for a DIFFERENT PayPal order id", () => {
    const result = verifyCaptureAgainstOrder(
      { id: "paypal-order-OTHER", status: "COMPLETED", capture: { id: "cap-5", status: "COMPLETED", amount: amountOf(143481) } },
      ORDER_ID,
      143481,
      "USD",
    );
    expect(result).toEqual({ ok: false, reason: "provider_order_id_mismatch" });
  });

  it("rejects DECLINED and unexpected statuses", () => {
    expect(
      verifyCaptureAgainstOrder(
        { id: ORDER_ID, status: "DECLINED", capture: null },
        ORDER_ID,
        143481,
        "USD",
      ),
    ).toEqual({ ok: false, reason: "capture_status_declined" });
    expect(
      verifyCaptureAgainstOrder(
        { id: ORDER_ID, status: "VOIDED", capture: null },
        ORDER_ID,
        143481,
        "USD",
      ),
    ).toEqual({ ok: false, reason: "capture_status_voided" });
  });
});
