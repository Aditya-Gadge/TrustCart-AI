import { fileURLToPath } from "node:url";
import "dotenv/config";
import { defineConfig } from "vitest/config";

/**
 * Vitest for TrustCart AI.
 *
 * - `@` resolves exactly like the Next.js tsconfig (./src).
 * - `server-only` is Next's guard package (throws when imported from client
 *   bundles). Vitest runs server-side, so it is aliased to an empty stub —
 *   the guard itself is enforced by the Next.js production build.
 * - DATABASE_URL is loaded from .env before collection so the integration
 *   suite correctly decides whether to run or skip.
 * - Integration tests legitimately touch PostgreSQL (local Docker); they
 *   are skipped automatically when no database is configured.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    // tests/e2e are Playwright specs (`npm run test:e2e`) — vitest must not
    // collect them (they import @playwright/test and need running servers).
    exclude: ["tests/e2e/**", "**/node_modules/**"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites share ONE PostgreSQL database. Fixture NUMBERS are
    // disjoint, but count-based assertions (e.g. KPI reconciliation) need a
    // stable row population, so test FILES must not run in parallel.
    // Total runtime stays in the low seconds.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
