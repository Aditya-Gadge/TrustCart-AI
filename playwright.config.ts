import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E (Phase 6) — two isolated server environments:
 *
 * - "core" server (port 3100): provider env keys are BLANKED so the app runs
 *   in its deterministic unconfigured/fallback states (copilot DB fallback,
 *   payments "not configured" panel). Daily merchant workflow tests.
 * - "checkout" server (port 3101): PayPal keys set to fake-but-valid-shaped
 *   values so the checkout UI renders, with the PayPal SDK script and both
 *   payment API calls intercepted in the test — a clearly-labelled MOCKED
 *   Sandbox checkout. The REAL Sandbox checkout test lives in the same file
 *   and is skipped unless real credentials AND sandbox buyer credentials are
 *   configured (see the skip message for the manual procedure).
 *
 * Both servers share the real seeded PostgreSQL database via .env.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "npm run start -- -p 3100",
      url: "http://127.0.0.1:3100/api/stats",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        GEMINI_API_KEY: "",
        PAYPAL_CLIENT_ID: "",
        PAYPAL_CLIENT_SECRET: "",
        PAYPAL_WEBHOOK_ID: "",
      },
    },
    {
      command: "npm run start -- -p 3101",
      url: "http://127.0.0.1:3101/api/stats",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        GEMINI_API_KEY: "",
        PAYPAL_CLIENT_ID: "e2e-fake-client-id-1234567890",
        PAYPAL_CLIENT_SECRET: "e2e-fake-client-secret-1234567890",
        PAYPAL_WEBHOOK_ID: "",
      },
    },
  ],
  projects: [
    {
      name: "core",
      testIgnore: /sandbox-checkout/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3100" },
    },
    {
      name: "checkout",
      testMatch: /sandbox-checkout/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3101" },
    },
  ],
});
