import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6 merchant workflow E2E — runs against the "core" production server
 * (port 3100) with provider keys BLANKED: copilot and PayPal run in their
 * deterministic unconfigured/fallback states, and the database is the real
 * seeded PostgreSQL dataset from .env.
 *
 * Covers: KPI↔database reconciliation, order search/filter/pagination,
 * review decision persistence + audit, copilot stored-data fallback,
 * payments unconfigured states, 404 handling, responsive layouts (375/768/
 * 1280), keyboard accessibility, and browser console cleanliness.
 *
 * NOTE: the order explorer does NOT initialize from URL query params, so
 * every filter is driven through the UI controls.
 */

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "document must not scroll horizontally").toBeLessThanOrEqual(1);
}

/** Wait until the explorer's counter reflects the given API query total. */
async function filterByStatus(
  page: Page,
  value: "PENDING" | "APPROVED",
): Promise<void> {
  const api = await page
    .request.get(`/api/orders?status=${value}&pageSize=1`)
    .then((res) => res.json() as Promise<{ total: number }>);
  await page.goto("/orders");
  await page.getByLabel("Review status", { exact: true }).selectOption(value);
  // The counter re-renders only when the filtered fetch lands, so this waits
  // out the stale "ALL" rows deterministically.
  await expect(
    page.getByText(new RegExp(`^${api.total} orders? match`)),
  ).toBeVisible();
}

test("dashboard KPIs reconcile with the /api/stats database aggregates", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  const stats = await page.request.get("/api/stats").then((res) => res.json());
  expect(stats).toHaveProperty("totalOrders");

  // Values appear in the "Key metrics" region AND in the queue snapshot —
  // scope every assertion to the region, then to the exact KPI card.
  const region = page.getByRole("region", { name: "Key metrics" });
  const labels: [string, number][] = [
    ["Orders in database", stats.totalOrders],
    ["Awaiting review", stats.pending],
    ["Held for review", stats.held],
    ["High risk", stats.highRisk],
  ];
  for (const [label, expected] of labels) {
    const card = region.locator("div").filter({
      has: page.getByText(label, { exact: true }),
    });
    await expect(
      card.getByText(expected.toLocaleString("en-US"), { exact: true }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("orders list: search, status filter, and pagination behave consistently", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const newest = await page
    .request.get("/api/orders?sort=newest&pageSize=1")
    .then((res) => res.json() as Promise<{ total: number; items: { orderNumber: string }[] }>);
  const orderNumber = newest.items[0]?.orderNumber;
  expect(orderNumber, "seeded database must contain at least one order").toBeTruthy();

  await page.goto("/orders");
  const counter = page.getByText(/\d+ orders? match/);
  await expect(counter).toContainText(`${newest.total} orders match`);

  // Search by an order number known to exist (unique order numbers → 1 hit).
  await page.getByLabel("Search", { exact: true }).fill(orderNumber ?? "");
  await expect(page.getByText(/^1 order match/)).toBeVisible();
  await expect(page.locator("table tbody")).toContainText(orderNumber ?? "");

  // Clearing search restores the full dataset counter.
  await page.getByLabel("Search", { exact: true }).fill("");
  await expect(counter).toContainText(`${newest.total} orders match`);

  // Status filter: every visible row badge is Pending.
  await page.getByLabel("Review status", { exact: true }).selectOption("PENDING");
  await expect(page.getByText(/^\d+ orders? match/)).toBeVisible();
  const pending = await page
    .request.get("/api/orders?status=PENDING&pageSize=1")
    .then((res) => res.json() as Promise<{ total: number }>);
  await expect(page.getByText(new RegExp(`^${pending.total} orders? match`))).toBeVisible();
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  expect(rowCount, "filtered page must show rows").toBeGreaterThan(0);
  for (let i = 0; i < rowCount; i++) {
    await expect(rows.nth(i).getByText("Pending", { exact: true })).toBeVisible();
  }

  // Pagination: Next moves to page 2 and Previous returns.
  await page.getByLabel("Review status", { exact: true }).selectOption("ALL");
  await expect(counter).toContainText(`${newest.total} orders match`);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("review approve flow persists a decision, refreshes the page, and writes an audit event", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await filterByStatus(page, "PENDING");

  // Open the first pending order's investigation view.
  const orderLink = page
    .locator("table tbody tr")
    .first()
    .getByRole("link")
    .filter({ hasText: /^TC-\d+$/ })
    .first();
  const orderNumber = (await orderLink.innerText()).trim();
  await orderLink.click();
  await expect(page.getByRole("heading", { name: `Order ${orderNumber}` })).toBeVisible();

  // Approve with a written reason (confirm dialog).
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#review-reason").fill("E2E: signals checked, low exposure — approving.");
  await dialog.getByRole("button", { name: "Confirm approve" }).click();

  // The server's decision is persisted and echoed back…
  await expect(page.getByText(/Decision recorded/)).toBeVisible();
  // …the page refreshes (audit timeline now holds the decision + reason)…
  await expect(
    page
      .locator("section[aria-label='Audit timeline']")
      .getByText("E2E: signals checked")
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("copilot degrades to a live stored-data fallback panel when unconfigured", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/copilot");

  await page.locator("#copilot-question").fill("Which orders are highest risk right now?");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Keys are blanked on the core server → the route 503s with
  // copilot_unconfigured (the browser logs that 503 — expected, filtered
  // below) and the client shows a stored-data fallback panel.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(/Copilot unavailable — here is live stored data instead/),
  ).toBeVisible();
  // The fallback lists REAL stored high-risk orders from /api/orders.
  const fallbackNumbers = page.getByRole("link").filter({ hasText: /^TC-\d+$/ });
  expect(await fallbackNumbers.count()).toBeGreaterThan(0);
  // Retry affordance is present.
  await expect(page.getByRole("button", { name: "Retry question" })).toBeVisible();

  const unexpected = errors.filter(
    (error) => !/Failed to load resource.*503/.test(error),
  );
  expect(unexpected).toEqual([]);
});

test("payments: an approved order shows the labelled unconfigured panel; a pending order defers checkout", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  // APPROVED orders may or may not carry an active payment already; visit up
  // to the first five until one shows the checkout (unconfigured) panel.
  await filterByStatus(page, "APPROVED");
  const approvedLinks = page
    .locator("table tbody a")
    .filter({ hasText: /^TC-\d+$/ });
  const approvedCount = await approvedLinks.count();
  // Harvest hrefs BEFORE navigating away — the locators only resolve on the
  // list page.
  const approvedHrefs: string[] = [];
  for (let i = 0; i < Math.min(approvedCount, 5); i++) {
    approvedHrefs.push((await approvedLinks.nth(i).getAttribute("href")) ?? "/orders");
  }
  let panelFound = false;
  for (const href of approvedHrefs) {
    await page.goto(href);
    const visible = await page
      .getByText("PayPal Sandbox not configured")
      .waitFor({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      panelFound = true;
      break;
    }
  }
  expect(panelFound, "an approved order without an active payment must show the labelled unconfigured panel").toBe(true);
  await expect(
    page.getByText(/Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET/),
  ).toBeVisible();

  // A PENDING order defers checkout explicitly.
  await filterByStatus(page, "PENDING");
  const pendingLinks = page
    .locator("table tbody a")
    .filter({ hasText: /^TC-\d+$/ });
  const pendingCount = await pendingLinks.count();
  const pendingHrefs: string[] = [];
  for (let i = 0; i < Math.min(pendingCount, 3); i++) {
    pendingHrefs.push((await pendingLinks.nth(i).getAttribute("href")) ?? "/orders");
  }
  let deferredFound = false;
  for (const href of pendingHrefs) {
    await page.goto(href);
    const visible = await page
      .getByText("Payments can be collected once the order is approved by a reviewer.")
      .waitFor({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      deferredFound = true;
      break;
    }
  }
  expect(deferredFound, "a pending order must defer checkout explicitly").toBe(true);
  expect(errors).toEqual([]);
});

test("unknown routes render the app's own 404 page", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByText("Page not found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to orders" })).toBeVisible();
});

test.describe("responsive layouts", () => {
  for (const viewport of [
    { name: "mobile", width: 375, height: 667 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    test(`no horizontal overflow at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ["/", "/orders", "/investigations", "/copilot", "/settings"]) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

test("keyboard: search dialog opens via keyboard and closes on Escape", async ({ page }) => {
  await page.goto("/");
  const searchButton = page.getByRole("button", { name: "Search orders" });
  await searchButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The search input is type="search" → role searchbox — and it autofocuses.
  await expect(dialog.getByRole("searchbox", { name: "Search orders" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("browser console stays clean during the dashboard and orders workflows", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.goto("/orders");
  await page.goto("/investigations");
  expect(errors).toEqual([]);
});
