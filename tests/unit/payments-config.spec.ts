import { afterEach, describe, expect, it } from "vitest";
import { getPayPalConfig, PAYPAL_SANDBOX_BASE_URL } from "@/lib/payments/paypal";

/**
 * Sandbox-only enforcement for the PayPal environment configuration. The
 * config parser must refuse a live host outright and require both Sandbox
 * credentials; webhook id is optional.
 */
describe("PayPal environment configuration (sandbox only)", () => {
  const ORIGINAL: Record<string, string | undefined> = {};
  const KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_BASE_URL", "PAYPAL_WEBHOOK_ID"];

  afterEach(() => {
    for (const key of KEYS) {
      if (ORIGINAL[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL[key];
      delete ORIGINAL[key];
    }
  });

  function setEnv(values: Record<string, string | undefined>) {
    for (const key of KEYS) {
      ORIGINAL[key] = process.env[key];
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  }

  it("returns null when credentials are absent (app boots, payments hidden)", () => {
    setEnv({ PAYPAL_CLIENT_ID: undefined, PAYPAL_CLIENT_SECRET: undefined });
    expect(getPayPalConfig()).toBeNull();
  });

  it("accepts Sandbox credentials without a base URL (sandbox default)", () => {
    setEnv({
      PAYPAL_CLIENT_ID: "AW-sandbox-client-id-1234567890",
      PAYPAL_CLIENT_SECRET: "EG-sandbox-client-secret-1234567890",
    });
    const config = getPayPalConfig();
    expect(config).not.toBeNull();
    expect(config?.baseUrl).toBe(PAYPAL_SANDBOX_BASE_URL);
    expect(config?.webhookId).toBeUndefined();
    expect(config?.clientSecret).toBe("EG-sandbox-client-secret-1234567890");
  });

  it("refuses the LIVE PayPal host outright", () => {
    setEnv({
      PAYPAL_CLIENT_ID: "AW-sandbox-client-id-1234567890",
      PAYPAL_CLIENT_SECRET: "EG-sandbox-client-secret-1234567890",
      PAYPAL_BASE_URL: "https://api-m.paypal.com",
    });
    expect(getPayPalConfig()).toBeNull();
  });

  it("keeps the optional webhook id and rejects short credentials", () => {
    setEnv({
      PAYPAL_CLIENT_ID: "AW-sandbox-client-id-1234567890",
      PAYPAL_CLIENT_SECRET: "EG-sandbox-client-secret-1234567890",
      PAYPAL_WEBHOOK_ID: "3XY12345XY6789012",
    });
    expect(getPayPalConfig()?.webhookId).toBe("3XY12345XY6789012");

    setEnv({ PAYPAL_CLIENT_ID: "short", PAYPAL_CLIENT_SECRET: "EG-sandbox-client-secret-1234567890" });
    expect(getPayPalConfig()).toBeNull();
  });
});
