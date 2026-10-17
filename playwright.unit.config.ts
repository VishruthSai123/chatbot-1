import { defineConfig } from "@playwright/test";

/**
 * Browser-free unit test runner.
 *
 * Reuses Playwright's TypeScript transform so pure modules under `lib/` can be
 * imported directly (no extra test dependency, no dev server, no browser).
 */
export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  reporter: "list",
  testDir: "./tests/unit",
  testMatch: /.*\.test\.ts/,
  timeout: 30 * 1000,
});
