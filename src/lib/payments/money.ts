/**
 * Money helpers for the PayPal flow (Phase 5).
 *
 * The application stores integer minor units; the PayPal Orders API takes
 * decimal strings. Only currencies the demo actually seeds are mapped —
 * an unmapped currency is a programming error and must fail loudly rather
 * than be charged with a wrong exponent.
 */

const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
};

/** 143481 minor units + "USD" → "1434.81" (string, no float arithmetic). */
export function minorUnitsToDecimalString(minor: number, currency: string): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error(`Unsupported currency for PayPal flow: ${currency}`);
  }
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor).toString().padStart(exponent + 1, "0");
  const whole = abs.slice(0, abs.length - exponent);
  const fraction = abs.slice(abs.length - exponent);
  return `${sign}${whole}.${fraction}`;
}

/** "1434.81" + "USD" → 143481 minor units (pure integer parse, no floats). */
export function decimalStringToMinorUnits(value: string, currency: string): number {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error(`Unsupported currency for PayPal flow: ${currency}`);
  }
  const match = /^(-?)(\d+)\.(\d+)$/.exec(value);
  if (!match || match[3].length !== exponent) {
    throw new Error(`Malformed PayPal amount ${value} for ${currency}`);
  }
  // Pure integer arithmetic (Phase 6): string digits → BigInt → exact minor
  // units. Values beyond Number's safe integer range are REFUSED rather than
  // silently rounded — a payment amount must never lose precision.
  const sign = match[1] === "-" ? BigInt(-1) : BigInt(1);
  const minor = sign * (BigInt(match[2]) * BigInt(10) ** BigInt(exponent) + BigInt(match[3]));
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (minor > maxSafe || minor < maxSafe * BigInt(-1)) {
    throw new Error(
      `PayPal amount ${value} for ${currency} exceeds the safe integer minor-unit range`,
    );
  }
  return Number(minor);
}
