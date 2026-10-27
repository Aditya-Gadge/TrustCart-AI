import { expect, test, type Page } from "@playwright/test";

/**
 * Sandbox checkout E2E (Phase 6) — runs against the "checkout" production
 * server (port 3101) with FAKE-but-valid-shaped PayPal credentials so the
 * checkout UI renders. Two clearly-labelled variants:
 *
 * 1. @mocked — the PayPal SDK script and BOTH payment API calls are
 *    intercepted in the browser. NO network reaches PayPal and NO payment
 *    rows are written (the stubs never hit our server). Asserts the
 *    client→server trust boundary: the capture request body contains ONLY
 *    the PayPal order reference — never amounts or statuses.
 *
 * 2. REAL — drives the actual PayPal Sandbox (no stubs) and is SKIPPED
 *    unless sandbox buyer credentials are configured (PAYPAL_BUYER_EMAIL /
 *    PAYPAL_BUYER_PASSWORD). This test only counts as run when those env
 *    vars exist; record its result in PROJECT_STATUS.md whenever it runs.
 */

const REAL_BUYER_CONFIGURED =
  process.env.PAYPAL_BUYER_EMAIL !== undefined &&
  process.env.PAYPAL_BUYER_EMAIL !== "" &&
  process.env.PAYPAL_BUYER_PASSWORD !== undefined &&
  process.env.PAYPAL_BUYER_PASSWORD !== "";

const MOCK_SDK_SCRIPT = `
window.paypal = {
  Buttons: (options) => ({
    // The library calls close().catch() on unmount — close must return a
    // promise, not undefined.
    close: () => Promise.resolve(),
    // @paypal/react-paypal-js calls isEligible() unconditionally before
    // render() — the mock must expose it or render fails.
    isEligible: () => true,
    render: async (container) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Mock PayPal Pay";
      button.style.cssText = "padding:10px 20px;background:#0070ba;color:#fff;border-radius:24px;border:none;cursor:pointer;font-size:14px;";
      button.addEventListener("click", async () => {
        try {
          const orderID = await options.createOrder();
          await options.onApprove({ orderID });
        } catch (error) {
          if (options.onError) options.onError(error);
        }
      });
      container.innerHTML = "";
      container.appendChild(button);
    },
  }),
};
`;

/**
 * Open an APPROVED order WITHOUT an active payment (only those render the
 * checkout panel). Approved orders with an existing VERIFIED payment show
 * payment history instead, so iterate up to the first five rows.
 */
async function openApprovedOrder(page: Page): Promise<string> {
  const api = await page
    .request.get("/api/orders?status=APPROVED&pageSize=1")
    .then((res) => res.json() as Promise<{ total: number }>);
  await page.goto("/orders");
  await page.getByLabel("Review status", { exact: true }).selectOption("APPROVED");
  await expect(page.getByText(new RegExp(`^${api.total} orders? match`))).toBeVisible();

  const links = page.locator("table tbody a").filter({ hasText: /^TC-\d+$/ });
  const count = await links.count();
  // Harvest number + href pairs BEFORE navigating away — the locators only
  // resolve on the list page.
  const candidates: { orderNumber: string; href: string }[] = [];
  for (let i = 0; i < Math.min(count, 5); i++) {
    candidates.push({
      orderNumber: (await links.nth(i).innerText()).trim(),
      href: (await links.nth(i).getAttribute("href")) ?? "/orders",
    });
  }
  for (const candidate of candidates) {
    await page.goto(candidate.href);
    await expect(
      page.getByRole("heading", { name: `Order ${candidate.orderNumber}` }),
    ).toBeVisible();
    const panelFound = await page
      .getByText("Collect payment via PayPal Sandbox")
      .waitFor({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (panelFound) return candidate.orderNumber;
  }
  throw new Error(
    "No APPROVED order without an active payment found in the first five rows",
  );
}

test("(MOCKED) sandbox checkout verifies server-side with a reference-only capture request", async ({ page }) => {
  // ── Stubs: SDK + both payment API calls (nothing reaches PayPal) ──
  await page.route("**/sdk/js*", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_SDK_SCRIPT }),
  );

  const createBodies: string[] = [];
  await page.route("**/api/orders/*/payments", async (route) => {
    createBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        paymentId: "e2e-payment-id",
        providerOrderId: "PAYPAL-E2E-MOCK-ORDER",
        status: "CREATED",
        amountMinor: 12345,
        currency: "USD",
        reused: false,
      }),
    });
  });

  const captureBodies: string[] = [];
  await page.route("**/api/orders/*/payments/capture", async (route) => {
    captureBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payment: {
          id: "e2e-payment-id",
          providerOrderId: "PAYPAL-E2E-MOCK-ORDER",
          providerCaptureId: "CAPTURE-E2E-MOCK",
          status: "VERIFIED",
          amountMinor: 12345,
          currency: "USD",
          verifiedAt: new Date().toISOString(),
        },
      }),
    });
  });

  // ── Flow: open an eligible approved order, pay, server verifies ──
  await openApprovedOrder(page);
  await page.getByRole("button", { name: "Mock PayPal Pay" }).click();
  await expect(page.getByText(/Payment verified server-side/)).toBeVisible();
  // The busy state is gone — nothing left spinning.
  await expect(
    page.getByText(/Confirming the payment with PayPal server-side/i),
  ).toBeHidden();

  // ── Trust-boundary assertions ──
  // The create call must carry NO browser-supplied amount/status body.
  expect(createBodies).toHaveLength(1);
  expect((createBodies[0] ?? "").trim()).toBe("");
  // The capture call carries ONLY the PayPal order reference.
  expect(captureBodies).toHaveLength(1);
  const capturePayload = JSON.parse(captureBodies[0] ?? "{}") as Record<string, unknown>;
  expect(Object.keys(capturePayload).sort()).toEqual(["providerOrderId"]);
  expect(capturePayload.providerOrderId).toBe("PAYPAL-E2E-MOCK-ORDER");
});

test("(MOCKED) a declined capture is shown honestly and never marked verified", async ({ page }) => {
  await page.route("**/sdk/js*", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_SDK_SCRIPT }),
  );
  await page.route("**/api/orders/*/payments", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        paymentId: "e2e-payment-id-2",
        providerOrderId: "PAYPAL-E2E-MOCK-DECLINED",
        status: "CREATED",
        amountMinor: 5000,
        currency: "USD",
        reused: false,
      }),
    }),
  );
  await page.route("**/api/orders/*/payments/capture", (route) =>
    route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({
        error: "capture_declined",
        message: "PayPal declined the capture. No payment was recorded as received.",
      }),
    }),
  );

  await openApprovedOrder(page);
  await page.getByRole("button", { name: "Mock PayPal Pay" }).click();
  // Scope to the Payments region: Next.js's route announcer is also
  // role="alert" and would trip strict mode.
  await expect(
    page.getByRole("region", { name: "Payments" }).getByRole("alert"),
  ).toContainText("PayPal declined the capture. No payment was recorded as received.");
  await expect(page.getByText(/Payment verified server-side/i)).toBeHidden();
});

test("(REAL) PayPal Sandbox checkout end-to-end", async ({ page }) => {
  // Clearly identified REAL-provider test: skipped unless sandbox buyer
  // credentials are configured. Drives the REAL PayPal SDK with no stubs.
  test.skip(
    !REAL_BUYER_CONFIGURED,
    "REAL Sandbox checkout requires PAYPAL_BUYER_EMAIL + PAYPAL_BUYER_PASSWORD in the environment. " +
      "When provided, this test drives the actual PayPal Sandbox popup login and payment; " +
      "it must never be reported as passing without a real run.",
  );

  const orderNumber = await openApprovedOrder(page);

  // The REAL SDK renders its buttons inside an iframe; click the Pay button.
  const payButton = page
    .frameLocator("iframe")
    .getByRole("button", { name: /pay|paypal/i })
    .first();
  await payButton.click({ timeout: 30_000 });

  // PayPal opens the login popup — drive the sandbox buyer login.
  const popup = await page.waitForEvent("popup");

  const emailField = popup.getByRole("textbox", { name: /email/i });
  await emailField.waitFor({ timeout: 60_000 });
  await emailField.fill(process.env.PAYPAL_BUYER_EMAIL ?? "");
  await popup.getByRole("button", { name: /next|log in/i }).click();
  const passwordField = popup.getByRole("textbox", { name: /password/i });
  await passwordField.fill(process.env.PAYPAL_BUYER_PASSWORD ?? "");
  await popup.getByRole("button", { name: /log in/i }).click();

  // Approve the payment (sandbox review page).
  const payNow = popup
    .getByRole("button", { name: /pay now|agree.*pay|continue/i })
    .first();
  await payNow.waitFor({ timeout: 60_000 });
  await payNow.click();

  // Back on the merchant page: the SERVER's verified verdict is rendered.
  await expect(
    page.getByText(new RegExp(`Payment verified server-side.*${orderNumber}`, "s")),
  ).toBeVisible({ timeout: 60_000 });
});
